var exports = {}; 
let map, model, stream;
let isMonitoring = false;
let potholeDatabase = [];
let potholeLayer;
let originMarker, destinationMarker, routeLine;
let detectionCounter = 0; 

async function init() {

    map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([13.0827, 80.2707], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(map);
    potholeLayer = L.layerGroup().addTo(map);

    const saved = localStorage.getItem('pothole_db');
    if (saved) {
        potholeDatabase = JSON.parse(saved);
        potholeDatabase.forEach(loc => {
            L.circleMarker(loc, { radius: 8, color: '#ff4b2b', weight: 2 }).addTo(potholeLayer);
        });
    }
    document.getElementById("potholeHits").innerText = potholeDatabase.length;

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
}

window.onload = init;

function useMyLocation() {
    if (!navigator.geolocation) return alert("GPS not available");
    
    navigator.geolocation.getCurrentPosition(pos => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        document.getElementById("originInput").value = "My Current Location";
        
        if (originMarker) map.removeLayer(originMarker);
        originMarker = L.marker(coords).addTo(map).bindPopup("You are here").openPopup();
        map.setView(coords, 16);
    }, err => alert("Please allow Location access"), { enableHighAccuracy: true });
}

function setupAutocomplete(inputId, suggestionId, type) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(suggestionId);

    input.addEventListener('input', async () => {
        if (input.value.length < 3) { box.innerHTML = ""; return; }
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${input.value}&limit=5`);
        const data = await res.json();
        
        box.innerHTML = data.map(p => `
            <div class="suggestion-item" style="padding:10px; cursor:pointer; background:#222; border-bottom:1px solid #333;"
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
        originMarker = L.marker(coords).addTo(map);
    } else {
        if (destinationMarker) map.removeLayer(destinationMarker);
        destinationMarker = L.marker(coords).addTo(map);
    }
    map.setView(coords, 15);
}

function drawRoute() {
    if (!originMarker || !destinationMarker) return alert("Set markers first!");
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
                const isNear = path.some(c => L.latLng(p[0], p[1]).distanceTo(L.latLng(c[1], c[0])) < 25);
                if (isNear) count++;
            });
            if (count < minPot) { minPot = count; bestIdx = idx; }
        });

        const best = routes[bestIdx];
        const color = minPot === 0 ? '#00ff88' : '#4285F4';
        
        routeLine = L.geoJSON(best.geometry, { style: { color: color, weight: 8, opacity: 0.8 } }).addTo(map);
        
        routeLine.on('mousemove', (e) => {
            const hasPothole = potholeDatabase.some(p => map.distance(p, e.latlng) < 50);
            if (hasPothole) routeLine.setStyle({ color: '#ff4b2b', weight: 12 });
        });
        routeLine.on('mouseout', () => routeLine.setStyle({ color: color, weight: 8 }));

        map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
        alert(`Route Selected: Best path avoids ${potholeDatabase.length - minPot} hazards.`);
    });
}

async function startCamera() {
    if (isMonitoring) return;
    try {
        const video = document.getElementById("camera");

        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 160, height: 140, facingMode: "environment" } 
        });
        video.srcObject = stream;
        isMonitoring = true;
        document.getElementById("monitorBtn").innerText = "MONITORING...";

        setInterval(runLowResAI, 800); 
    } catch (e) { alert("Camera Denied"); }
}

async function runLowResAI() {
    if (!isMonitoring || !model) return;
    const video = document.getElementById("camera");
    if (video.readyState !== 4) return;

    const prediction = await tf.tidy(() => model.predict(video));
    let top = prediction.reduce((a, b) => a.probability > b.probability ? a : b);

    const surface = document.getElementById("currentSurface");
    document.getElementById("confidenceValue").innerText = (top.probability * 100).toFixed(0) + "%";

    if (top.probability > 0.98 && top.className.toLowerCase().includes("pothole")) {
        detectionCounter++;
        if (detectionCounter >= 2) { 
            surface.innerText = "POTHOLE!!";
            surface.style.color = "#ff4b2b";
            markPotholeOnMap();
            detectionCounter = 0;
        }
    } else {
        detectionCounter = 0;
        surface.innerText = "NORMAL";
        surface.style.color = "#00ff88";
    }
}

function markPotholeOnMap() {
    navigator.geolocation.getCurrentPosition(pos => {
        const loc = [pos.coords.latitude, pos.coords.longitude];
        const isDup = potholeDatabase.some(p => map.distance(p, loc) < 5);

        if (!isDup) {
            potholeDatabase.push(loc);
            localStorage.setItem('pothole_db', JSON.stringify(potholeDatabase));
            L.circleMarker(loc, { radius: 10, color: '#ff4b2b', fillOpacity: 0.8 }).addTo(potholeLayer);
            document.getElementById("potholeHits").innerText = potholeDatabase.length;
            updateAnalytics();
        }
    });
}

function resetNavigation() {
    if (originMarker) map.removeLayer(originMarker);
    if (destinationMarker) map.removeLayer(destinationMarker);
    if (routeLine) map.removeLayer(routeLine);
    document.getElementById("originInput").value = "";
    document.getElementById("destinationInput").value = "";
}

function clearDatabase() {
    if (confirm("Reset everything?")) {
        localStorage.clear();
        location.reload();
    }
}

function updateAnalytics() {
    const hits = potholeDatabase.length;
    document.getElementById("riskScore").innerText = Math.min(hits * 10, 100) + "%";
    document.getElementById("riskBar").style.width = Math.min(hits * 10, 100) + "%";
}