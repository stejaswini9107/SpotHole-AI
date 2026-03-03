const firebaseConfig = {
  apiKey: "AIzaSyDAtNFl1fgryEeQiYV_wSKwfSUjiK-K9lg",
  authDomain: "spothole-82a2c.firebaseapp.com",
  projectId: "spothole-82a2c",
  storageBucket: "spothole-82a2c.firebasestorage.app",
  messagingSenderId: "65250479066",
  appId: "1:65250479066:web:245ade34ccba06d3b78ee3"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let map, model, stream;
let isMonitoring = false;
let potholeLayer;
let originMarker, destinationMarker, routeLine;
let detectionCounter = 0; 
let watchId = null;

async function init() {

    map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([13.0827, 80.2707], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(map);
    potholeLayer = L.layerGroup().addTo(map);

    db.collection("potholes").onSnapshot((snapshot) => {
        potholeLayer.clearLayers();
        let count = 0;
        snapshot.forEach((doc) => {
            const data = doc.data();
            L.circleMarker([data.lat, data.lng], { 
                radius: 4, color: '#ff4b2b', weight: 2, fillOpacity: 0.5 
            }).addTo(potholeLayer);
            count++;
        });
        updateAnalytics(count);
    });

    if (typeof tmImage !== "undefined") {
        try {
            const modelURL = "./"; 
            model = await tmImage.load(modelURL + "model.json", modelURL + "metadata.json");
            document.getElementById("system-status").innerText = "System: ONLINE";
            document.querySelector(".dot").style.background = "#00ff88";
            document.querySelector(".dot").style.boxShadow = "0 0 10px #00ff88";
        } catch (e) { 
            console.error("AI Loading Failed:", e);
            document.getElementById("system-status").innerText = "System: AI ERROR"; 
        }
    } else {
        document.getElementById("system-status").innerText = "System: LIB MISSING";
    }

    setupAutocomplete("originInput", "originSuggestions", "origin");
    setupAutocomplete("destinationInput", "destinationSuggestions", "destination");

    document.addEventListener("click", (e) => {
        if (!e.target.closest(".search-container")) {
            document.getElementById("originSuggestions").style.display = "none";
            document.getElementById("destinationSuggestions").style.display = "none";
        }
    });
}

window.onload = init;

function useMyLocation() {
    if (!navigator.geolocation) return alert("GPS not available");
    if (watchId) navigator.geolocation.clearWatch(watchId);
    const options = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
    watchId = navigator.geolocation.watchPosition(pos => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        if (originMarker) {
            originMarker.setLatLng(coords);
        } else {
            originMarker = L.marker(coords).addTo(map).bindPopup("Live Location").openPopup();
        }
        map.setView(coords, map.getZoom(), { animate: false });
        document.getElementById("originInput").value = "Live GPS Active";
    }, err => console.warn("GPS Error: ", err), options);
}

function setupAutocomplete(inputId, suggestionId, type) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(suggestionId);
    input.addEventListener('input', async () => {
        if (input.value.length < 3) { box.style.display = "none"; return; }
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${input.value}&limit=5`);
            const data = await res.json();
            box.innerHTML = data.map(p => `
                <div class="suggestion-item" 
                     onclick="selectLocation('${p.lat}','${p.lon}','${p.display_name.split(',')[0]}','${inputId}','${suggestionId}','${type}')">
                    ${p.display_name}
                </div>
            `).join('');
            box.style.display = "block";
        } catch (e) { console.error("Search error", e); }
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

async function drawRoute() {
    if (!originMarker || !destinationMarker) return alert("Select start and end points!");
    const start = originMarker.getLatLng();
    const end = destinationMarker.getLatLng();
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=true`;

    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || data.routes.length === 0) return alert("No route found!");

    const snapshot = await db.collection("potholes").get();
    const allPotholes = [];
    snapshot.forEach(doc => allPotholes.push(doc.data()));

    let bestIdx = 0;
    let minPotCount = Infinity;

    data.routes.forEach((r, idx) => {
        let count = 0;
        const path = r.geometry.coordinates;
        allPotholes.forEach(p => {
            const isNear = path.some(c => map.distance([p.lat, p.lng], [c[1], c[0]]) < 35);
            if (isNear) count++;
        });
        if (count < minPotCount) { minPotCount = count; bestIdx = idx; }
    });

    if (routeLine) map.removeLayer(routeLine);
    const best = data.routes[bestIdx];
    const color = minPotCount === 0 ? '#00ff88' : '#4285F4';
    routeLine = L.geoJSON(best.geometry, { style: { color: color, weight: 8, opacity: 0.8 } }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
    alert(`Smart Route Selected: ${minPotCount} potholes detected on this path.`);
}

async function startCamera() {
    if (isMonitoring) return;
    const video = document.getElementById("camera");
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: {ideal: 320}, height: {ideal: 240} } 
        });
        video.srcObject = stream;
        isMonitoring = true;
        document.getElementById("monitorBtn").innerText = "STOP AI";
        setInterval(runLowResAI, 1500); // Slower interval to prevent RAM lag
    } catch (e) { alert("Camera Access Required."); }
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
        if (detectionCounter >= 3) { 
            surface.innerText = "POTHOLE DETECTED!";
            surface.style.color = "#ff4b2b";
            markPotholeOnCloud();
            detectionCounter = 0;
        }
    } else {
        detectionCounter = 0;
        surface.innerText = "ROAD CLEAR";
        surface.style.color = "#00ff88";
    }
}

function markPotholeOnCloud() {
    navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        
        // Sync to Firebase Cloud
        db.collection("potholes").add({
            lat: lat,
            lng: lng,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }, null, { enableHighAccuracy: true });
}

function updateAnalytics(hits) {
    const risk = Math.min(hits * 10, 100);
    const accident = Math.min(hits * 15, 100);
    document.getElementById("potholeHits").innerText = hits;
    document.getElementById("riskScore").innerText = risk + "%";
    document.getElementById("accidentScore").innerText = accident + "%";
    const rBar = document.getElementById("riskBar");
    const aBar = document.getElementById("accidentBar");
    if(rBar) rBar.style.width = risk + "%";
    if(aBar) aBar.style.width = accident + "%";
}

function clearDatabase() {
    if (confirm("This will clear cloud data for all devices. Proceed?")) {
        db.collection("potholes").get().then((snapshot) => {
            snapshot.forEach((doc) => doc.ref.delete());
        });
    }
}
