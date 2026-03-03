var exports = {}; 
let map, model, stream;
let isMonitoring = false;
let potholeDatabase = [];
let potholeLayer;
let originMarker, destinationMarker, routeLine;
let detectionCounter = 0; 
let watchId = null; 

async function init() {
    map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([13.0827, 80.2707], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(map);
    potholeLayer = L.layerGroup().addTo(map);

    const saved = localStorage.getItem('pothole_db');
    if (saved) {
        potholeDatabase = JSON.parse(saved);
        potholeDatabase.forEach(loc => {
            L.circleMarker(loc, { radius: 8, color: '#ff4b2b', weight: 2, fillOpacity: 0.5 }).addTo(potholeLayer);
        });
    }
    
    updateAnalytics(); 

    if (typeof tmImage !== "undefined") {
        try {
            const modelURL = "./model/"; 
            model = await tmImage.load(modelURL + "model.json", modelURL + "metadata.json");
            document.getElementById("system-status").innerText = "AI: ONLINE";
            document.querySelector(".dot").style.background = "#00ff88";
        } catch (e) { document.getElementById("system-status").innerText = "AI: ERROR"; }
    }

    setupAutocomplete("originInput", "originSuggestions", "origin");
    setupAutocomplete("destinationInput", "destinationSuggestions", "destination");

    document.addEventListener("click", (e) => {
        if (!e.target.closest(".search-box")) {
            document.getElementById("originSuggestions").style.display = "none";
            document.getElementById("destinationSuggestions").style.display = "none";
        }
    });
}

window.onload = init;

function useMyLocation() {
    if (!navigator.geolocation) return alert("GPS not available");

    if (watchId) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(pos => {
        const coords = [pos.coords.latitude, pos.coords.longitude];

        if (originMarker) {
            originMarker.setLatLng(coords);
        } else {
            originMarker = L.marker(coords).addTo(map).bindPopup("Live Location").openPopup();
        }

        map.panTo(coords);
        document.getElementById("originInput").value = "Live GPS Active";
    }, err => alert("GPS Error: " + err.message), 
    { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
}

function setupAutocomplete(inputId, suggestionId, type) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(suggestionId);
    input.addEventListener('input', async () => {
        if (input.value.length < 3) { box.style.display = "none"; return; }
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${input.value}&limit=5`);
        const data = await res.json();
        box.innerHTML = data.map(p => `
            <div class="suggestion-item" style="padding:12px; cursor:pointer; background:#1a1a1a; border-bottom:1px solid #333;"
                 onclick="selectLocation('${p.lat}','${p.lon}','${p.display_name.split(',')[0]}','${inputId}','${suggestionId}','${type}')">
                ${p.display_name}
            </div>
        `).join('');
        box.style.display = "block";
    });
}

function selectLocation(lat, lon, name, inputId, suggestionId, type) {
    const coords = [parseFloat(lat), parseFloat(lon)];
    document.getElementById(inputId).value = name;
    document.getElementById(suggestionId).style.display = "none";

    if (type === 'origin') {
        if (originMarker) map.removeLayer(originMarker);
        originMarker = L.marker(coords, {draggable: true}).addTo(map);
    } else {
        if (destinationMarker) map.removeLayer(destinationMarker);
        destinationMarker = L.marker(coords, {draggable: true}).addTo(map);
    }
    map.setView(coords, 15);
}

function drawRoute() {
    if (!originMarker || !destinationMarker) return alert("Set Start & End locations!");
    const start = originMarker.getLatLng();
    const end = destinationMarker.getLatLng();
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=true`;

    fetch(url).then(res => res.json()).then(data => {
        if (routeLine) map.removeLayer(routeLine);
        let routes = data.routes;
        let bestIdx = 0;
        let minPot = Infinity;

        routes.forEach((r, idx) => {
            let count = 0;
            const path = r.geometry.coordinates;
            potholeDatabase.forEach(p => {
                const isNear = path.some(c => L.latLng(p[0], p[1]).distanceTo(L.latLng(c[1], c[0])) < 30);
                if (isNear) count++;
            });
            if (count < minPot) { minPot = count; bestIdx = idx; }
        });

        const best = routes[bestIdx];
        const color = minPot === 0 ? '#00ff88' : '#4285F4';
        routeLine = L.geoJSON(best.geometry, { style: { color: color, weight: 8, opacity: 0.8 } }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
    });
}

async function startCamera() {
    if (isMonitoring) return;
    try {
        const video = document.getElementById("camera");
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: "environment", 
                width: { ideal: 640 }, 
                height: { ideal: 480 } 
            } 
        });
        video.srcObject = stream;
        isMonitoring = true;
        document.getElementById("monitorBtn").innerText = "AI ACTIVE";
        setInterval(runLowResAI, 600); 
    } catch (e) { alert("Enable Camera Permissions"); }
}

async function runLowResAI() {
    if (!isMonitoring || !model) return;
    const video = document.getElementById("camera");
    if (video.readyState !== 4) return;

    const prediction = await tf.tidy(() => model.predict(video));
    let top = prediction.reduce((a, b) => a.probability > b.probability ? a : b);

    const surface = document.getElementById("currentSurface");
    document.getElementById("confidenceValue").innerText = (top.probability * 100).toFixed(0) + "%";

    if (top.probability > 0.97 && top.className.toLowerCase().includes("pothole")) {
        detectionCounter++;
        if (detectionCounter >= 2) { 
            surface.innerText = "POTHOLE DETECTED!";
            surface.style.color = "#ff4b2b";
            markPotholeOnMap();
            detectionCounter = 0;
        }
    } else {
        detectionCounter = 0;
        surface.innerText = "ROAD CLEAR";
        surface.style.color = "#00ff88";
    }
}

function markPotholeOnMap() {
    navigator.geolocation.getCurrentPosition(pos => {
        const loc = [pos.coords.latitude, pos.coords.longitude];
        const isDup = potholeDatabase.some(p => map.distance(p, loc) < 15);

        if (!isDup) {
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

            potholeDatabase.push(loc);
            localStorage.setItem('pothole_db', JSON.stringify(potholeDatabase));

            L.circleMarker(loc, { 
                radius: 12, 
                color: '#ff0000', 
                fillColor: '#ff4b2b', 
                fillOpacity: 0.9 
            }).addTo(potholeLayer);
            
            document.getElementById("potholeHits").innerText = potholeDatabase.length;
            updateAnalytics();
        }
    }, null, { enableHighAccuracy: true });
}

function updateAnalytics() {
    const hits = potholeDatabase.length;
    const risk = Math.min(hits * 10, 100);
    const accident = Math.min(hits * 15, 100);

    const riskEl = document.getElementById("riskScore");
    const accEl = document.getElementById("accidentScore");
    const rBar = document.getElementById("riskBar");
    const aBar = document.getElementById("accidentBar");

    if(riskEl) riskEl.innerText = risk + "%";
    if(accEl) accEl.innerText = accident + "%";
    if(rBar) rBar.style.width = risk + "%";
    if(aBar) aBar.style.width = accident + "%";
    
    document.getElementById("potholeHits").innerText = hits;
}

function clearDatabase() {
    if (confirm("Wipe all detected pothole data?")) {
        localStorage.removeItem('pothole_db');
        location.reload();
    }
}
