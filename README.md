## 🕳️ SpotHole AI: Intelligent Road Safety & Navigation
SpotHole AI is a real-time, browser-based computer vision application designed to detect road hazards (potholes) and calculate the safest driving routes. By combining TensorFlow.js for AI inference and Leaflet.js for geospatial mapping, the system allows users to contribute to a live hazard database and navigate around dangerous road segments.

## 🚀 Key Features
Real-Time AI Detection: Utilizes a custom-trained Teachable Machine model (via TensorFlow.js) to identify potholes with a 98% confidence threshold.

Smart Routing Engine: Integrates with the OSRM (Open Source Routing Machine) API to compare alternative routes and automatically select the path with the fewest recorded hazards.

Interactive Mapping: Built with Leaflet.js featuring custom markers, smooth "My Location" GPS tracking, and interactive "Risk Scanners" on hover.

Persistent Data Storage: Saves logged hazards to the browser's LocalStorage, ensuring your data remains available across sessions without a backend database.

Optimized Performance: Features a "Lag-Killer" logic (low-resolution processing and tf.tidy() memory management) to ensure smooth map movement during AI monitoring.

## 🛠️ Tech Stack
Frontend: HTML5, CSS3 (Modern Dark UI)

Maps: Leaflet.js & OpenStreetMap

AI/ML: TensorFlow.js & Teachable Machine

Routing: OSRM API

Geocoding: Nominatim (OSM)

## 📦 Installation & Setup
Clone the Repository:

Bash
git clone https://github.com/YOUR_USERNAME/spothole-ai.git
cd spothole-ai
Model Configuration:
Ensure your exported Teachable Machine files are placed in the /model directory:

model.json

metadata.json

weights.bin

Run Locally:
Open index.html using a local server (e.g., VS Code Live Server).
Note: Camera and GPS features require an https:// connection or localhost to function.

## Screenshots
<img width="1882" height="913" alt="Screenshot 2026-03-01 203743" src="https://github.com/user-attachments/assets/045cf206-9720-4631-861e-d097ad671d84" />
<img width="1886" height="912" alt="Screenshot 2026-03-01 203721" src="https://github.com/user-attachments/assets/4f20570d-00c6-483b-9844-3e4dcd29d58f" />
<img width="1891" height="960" alt="Screenshot 2026-03-01 203630" src="https://github.com/user-attachments/assets/ba20733a-a7f3-435b-8bfa-fd731beabce3" />
<img width="1874" height="946" alt="Screenshot 2026-03-01 203525" src="https://github.com/user-attachments/assets/5486391e-05ea-4456-9fdc-5df535a3a35f" />


## 🖥️ How It Works
Monitor: Mount your device on a vehicle dashboard and start the camera.

Detect: The AI scans the road. If a pothole is detected for 2 consecutive frames at >98% confidence, it is logged.

Analyze: The "Risk Score" and "Accident Probability" update dynamically based on the local dataset.

Navigate: Enter your destination. The system will analyze three possible routes and highlight the one that avoids the most potholes in Green.

## 🤝 Contributing
Contributions are welcome! Whether it's improving the AI model's accuracy or adding a dark mode for the map, feel free to fork the repo and submit a Pull Request.
