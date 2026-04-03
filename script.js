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
let lastDetection = null;
let aiInterval = null;
let modelLoaded = false;
let isFollowingLiveLocation = false;

const AI_MODEL_BASE = "./model/";
const DETECTION_INTERVAL_MS = 500;
const POTHOLE_CONFIDENCE_THRESHOLD = 0.82;
const POTHOLE_MARGIN_THRESHOLD = 0.12;
const REQUIRED_CONSECUTIVE_DETECTIONS = 3;
const DETECTION_COOLDOWN_MS = 4000;
const DEFAULT_MAP_ZOOM = 15;
const LIVE_TRACK_ZOOM = 17;

async function init() {

    map = L.map("map", { zoomControl: false, preferCanvas: true }).setView([13.0827, 80.2707], DEFAULT_MAP_ZOOM);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png")
        .addTo(map);

    potholeLayer = L.layerGroup().addTo(map);

    db.collection("potholes").onSnapshot((snapshot) => {

        potholeLayer.clearLayers();

        let count = 0;

        snapshot.forEach((doc) => {

            const data = doc.data();

            L.circleMarker([data.lat, data.lng], {
                radius: 4,
                color: "#ff4b2b",
                weight: 2,
                fillOpacity: 0.5
            }).addTo(potholeLayer);

            count++;
        });

        updateAnalytics(count);
    });

    if (typeof tmImage !== "undefined") {

        try {

            model = await tmImage.load(
                AI_MODEL_BASE + "model.json",
                AI_MODEL_BASE + "metadata.json"
            );
            modelLoaded = true;

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
    isFollowingLiveLocation = true;

    document.getElementById("originInput").value = "Locating current position...";
    document.getElementById("originSuggestions").style.display = "none";

    const options = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
    };

    watchId = navigator.geolocation.watchPosition(

        (pos) => {

            const coords = [pos.coords.latitude, pos.coords.longitude];

            originMarker = updateMarker(originMarker, coords, "Current Location");

            if (isFollowingLiveLocation) {
                map.setView(coords, Math.max(map.getZoom(), LIVE_TRACK_ZOOM), { animate: true });
            }

            document.getElementById("originInput").value = "Current Location";
        },

        (err) => {
            console.warn("GPS Error: ", err);
            document.getElementById("originInput").value = "";
            alert("Unable to get your live location. Please allow GPS access and try again.");
        },

        options
    );
}

function setupAutocomplete(inputId, suggestionId, type) {

    const input = document.getElementById(inputId);
    const box = document.getElementById(suggestionId);

    input.addEventListener("focus", () => {

        if (type === "origin" && input.value.trim().length === 0) {
            renderSuggestions(box, getCurrentLocationSuggestion(inputId, suggestionId));
        }
    });

    input.addEventListener("input", async () => {

        const query = input.value.trim();

        if (type === "origin" && query.length === 0) {
            renderSuggestions(box, getCurrentLocationSuggestion(inputId, suggestionId));
            return;
        }

        if (query.length < 3) {
            box.style.display = "none";
            return;
        }

        try {

            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`
            );

            const data = await res.json();

            const suggestions = data.map((p) => `
                <div class="suggestion-item"
                     onclick="selectLocation('${p.lat}','${p.lon}','${escapeSingleQuotes(p.display_name.split(",")[0])}','${inputId}','${suggestionId}','${type}')">
                    ${p.display_name}
                </div>
            `);

            if (type === "origin") {
                suggestions.unshift(...getCurrentLocationSuggestion(inputId, suggestionId));
            }

            renderSuggestions(box, suggestions);

        } catch (e) {

            console.error("Search error", e);
        }
    });
}

function renderSuggestions(box, suggestions) {

    box.innerHTML = suggestions.join("");
    box.style.display = suggestions.length > 0 ? "block" : "none";
}

function getCurrentLocationSuggestion(inputId, suggestionId) {

    return [
        `
            <div class="suggestion-item current-location-option"
                 onclick="selectCurrentLocation('${inputId}','${suggestionId}')">
                Use current location
            </div>
        `
    ];
}

function selectCurrentLocation(inputId, suggestionId) {

    document.getElementById(inputId).value = "Current Location";
    document.getElementById(suggestionId).style.display = "none";
    useMyLocation();
}

function selectLocation(lat, lon, name, inputId, suggestionId, type) {

    const coords = [parseFloat(lat), parseFloat(lon)];

    document.getElementById(inputId).value = name;
    document.getElementById(suggestionId).style.display = "none";

    if (type === "origin") {
        stopLiveLocationTracking();
        originMarker = updateMarker(originMarker, coords, "Origin", true);
    } else {
        destinationMarker = updateMarker(destinationMarker, coords, "Destination", true);
    }

    map.setView(coords, DEFAULT_MAP_ZOOM);
}

function updateMarker(marker, coords, label, draggable = false) {

    if (marker) {
        marker.setLatLng(coords);
        marker.unbindPopup();
        marker.bindPopup(label);
        return marker;
    }

    return L.marker(coords, { draggable }).addTo(map).bindPopup(label);
}

function stopLiveLocationTracking() {

    isFollowingLiveLocation = false;

    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
}

function escapeSingleQuotes(value) {

    return value.replace(/'/g, "\\'");
}

function formatDistance(distanceInMeters) {

    if (distanceInMeters < 1000) {
        return `${Math.round(distanceInMeters)} m`;
    }

    return `${(distanceInMeters / 1000).toFixed(1)} km`;
}

async function drawRoute() {

    if (!originMarker || !destinationMarker) {
        return alert("Select start and end points!");
    }

    const start = originMarker.getLatLng();
    const end = destinationMarker.getLatLng();

    const url =
        `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=true`;

    const res = await fetch(url);
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
        return alert("No route found!");
    }

    const snapshot = await db.collection("potholes").get();
    const allPotholes = [];

    snapshot.forEach((doc) => allPotholes.push(doc.data()));

    let bestIdx = 0;
    let minPotCount = Infinity;

    data.routes.forEach((route, idx) => {

        let count = 0;
        const path = route.geometry.coordinates;

        allPotholes.forEach((p) => {

            const isNear = path.some((c) =>
                map.distance([p.lat, p.lng], [c[1], c[0]]) < 35
            );

            if (isNear) count++;
        });

        if (count < minPotCount) {
            minPotCount = count;
            bestIdx = idx;
        }
    });

    if (routeLine) map.removeLayer(routeLine);

    const best = data.routes[bestIdx];
    const routeDistance = formatDistance(best.distance);
    const color = minPotCount === 0 ? "#00ff88" : "#4285F4";

    routeLine = L.geoJSON(best.geometry, {
        style: { color, weight: 8, opacity: 0.8 }
    }).addTo(map);

    map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

    alert(`Smart Route Selected\nDistance: ${routeDistance}\nPotholes on path: ${minPotCount}`);
}

async function startCamera() {

    if (isMonitoring) return;
    if (!modelLoaded) {
        alert("AI model is still loading. Please wait a moment and try again.");
        return;
    }

    const video = document.getElementById("camera");

    try {

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "environment",
                width: { ideal: 320 },
                height: { ideal: 240 }
            }
        });

        video.srcObject = stream;
        isMonitoring = true;

        document.getElementById("monitorBtn").innerText = "STOP AI";
        document.getElementById("currentSurface").innerText = "SCANNING...";
        document.getElementById("currentSurface").style.color = "#00f2ff";

        aiInterval = setInterval(runLowResAI, DETECTION_INTERVAL_MS);

    } catch (e) {

        alert("Camera Access Required.");
    }
}

async function runLowResAI() {

    if (!isMonitoring || !model) return;

    const video = document.getElementById("camera");

    if (video.readyState !== 4) return;

    const prediction = await model.predict(video);

    prediction.sort((a, b) => b.probability - a.probability);

    const top = prediction[0];
    const second = prediction[1] || { probability: 0 };

    const surface = document.getElementById("currentSurface");
    const confidence = document.getElementById("confidenceValue");

    if (!top) {
        surface.innerText = "NO SIGNAL";
        surface.style.color = "#ff4b2b";
        confidence.innerText = "0%";
        detectionCounter = 0;
        return;
    }

    confidence.innerText = `${(top.probability * 100).toFixed(0)}%`;

    if (
        top.probability >= POTHOLE_CONFIDENCE_THRESHOLD &&
        (top.probability - second.probability) >= POTHOLE_MARGIN_THRESHOLD &&
        top.className.toLowerCase().includes("pothole")
    ) {

        detectionCounter++;
        surface.innerText = `POTHOLE SUSPECTED (${detectionCounter}/${REQUIRED_CONSECUTIVE_DETECTIONS})`;
        surface.style.color = "#ffb347";

        if (detectionCounter >= REQUIRED_CONSECUTIVE_DETECTIONS) {
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

    navigator.geolocation.getCurrentPosition(

        (pos) => {

            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;

            if (lastDetection) {

                const dist = map.distance(
                    [lat, lng],
                    [lastDetection.lat, lastDetection.lng]
                );

                const withinDistanceWindow = dist < 10;
                const withinTimeWindow =
                    Date.now() - lastDetection.detectedAt < DETECTION_COOLDOWN_MS;

                if (withinDistanceWindow || withinTimeWindow) return;
            }

            lastDetection = { lat, lng, detectedAt: Date.now() };

            db.collection("potholes").add({
                lat,
                lng,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        },

        null,

        { enableHighAccuracy: true }
    );
}

function updateAnalytics(hits) {

    const risk = Math.min(hits * 10, 100);
    const accident = Math.min(hits * 15, 100);

    document.getElementById("potholeHits").innerText = hits;
    document.getElementById("riskScore").innerText = `${risk}%`;
    document.getElementById("accidentScore").innerText = `${accident}%`;

    const rBar = document.getElementById("riskBar");
    const aBar = document.getElementById("accidentBar");

    if (rBar) rBar.style.width = `${risk}%`;
    if (aBar) aBar.style.width = `${accident}%`;
}

function clearDatabase() {

    if (confirm("This will clear cloud data for all devices. Proceed?")) {

        db.collection("potholes").get().then((snapshot) => {
            snapshot.forEach((doc) => doc.ref.delete());
        });
    }
}
