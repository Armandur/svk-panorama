var mapSpots;
var editorModeListener = false;

var _mapEditorMode = false;

function loadMap(viewer, current, json, editorMode = false) {
    const timestamp = new Date().getTime(); // Prevent caching of the JSON

    _mapEditorMode = editorMode;

    // Load data from JSON if we haven't already, then work with mapSpots to support dynamic hotspots in mapEditorMode
    if (!mapSpots) {
        if (_mapEditorMode) {
            console.log("mapSpots not initialized, loading data from  " + json);
        }
        fetch(json + "?t=" + timestamp)
            .then(response => response.json())
            .then(data => {
                mapSpots = data;
                refreshMapButtons(viewer, mapSpots, current);
                updateCurrentButton(current);

                if (_mapEditorMode) {
                    mapEditorMode(viewer);
                }
            })
            .catch(error => {
                console.error('Error loading map data:', error);
            });
    } else {
        refreshMapButtons(viewer, mapSpots, current);
        updateCurrentButton(current);

        if (_mapEditorMode) {
            mapEditorMode(viewer);
        }
    }
}

function refreshMapButtons(viewer, data, current) {
    if (_mapEditorMode) {
        console.log("Refreshing buttons");
        console.log(mapSpots);
    }
    const mapContainer = document.getElementById('map-container');

    // Remove only elements with the class 'map-button'
    const mapButtons = mapContainer.querySelectorAll('.map-button');
    mapButtons.forEach(button => {
        mapContainer.removeChild(button);
    });

    // Re-add map buttons based on the data dictionary
    data.scenes.forEach(scene => {
        const button = document.createElement('a');
        button.className = 'map-button';
        button.style.top = scene.position.y + 'px';
        button.style.left = scene.position.x + 'px';
        button.dataset.id = scene.id;

        // Add .current class if it's the current scene
        if (scene.id === current) {
            button.classList.add('current');
        }

        // Click event to load the selected scene in the viewer
        button.addEventListener('click', function (event) {
            event.preventDefault();  // Prevent the default anchor action

            if (scene.id !== current) {
                viewer.loadScene(scene.id);  // Load the new scene
                updateCurrentButton(current);

                if (_mapEditorMode) {
                    console.log(`Clicked scene: ${scene.id} on map`);
                }
            }
        });

        // Append the button to the map container
        mapContainer.appendChild(button);
    });
}

function handleMapUpdate(viewer, x, y) {
    let current = viewer.getScene();

    console.log("Handling map update");

    // Find the current spot in mapSpots by ID
    let currentSpot = mapSpots.scenes.find(scene => scene.id === current);

    // If current scene doesn't exist in `mapSpots`, create a new one
    if (!currentSpot) {
        currentSpot = {
            id: current,
            position: { x: x, y: y }
        };
        mapSpots.scenes.push(currentSpot);  // Add the new scene
        console.log("Added new scene: ", currentSpot);
    } else {
        // If scene exists, update its position
        currentSpot.position = { x: x, y: y };
        console.log("Updating position of scene: ", currentSpot);
    }

    // Call refreshMapButtons to re-render buttons
    refreshMapButtons(viewer, mapSpots, current);
}

function mapEditorMode(viewer) {
    document.getElementById('map2').addEventListener('click', function (event) {
        // Handle click and calculate x, y

            const mapXCssOffset = 5; //Offset of map from browser edge in CSS
            const mapYCssOffset = 5;

        const mapContainer = document.getElementById('map-container');
        const rect = mapContainer.getBoundingClientRect();

            let x = parseFloat((event.clientX - rect.left - mapXCssOffset).toFixed(2));
            let y = parseFloat((event.clientY - rect.top - mapYCssOffset).toFixed(2));

            console.log(x + " " + y);

        handleMapUpdate(viewer, x, y);
    });
    editorModeListener = true;

    if (!addedListeners.includes('mapExport')) {
        window.addEventListener('keyup', mapExport);
        addedListeners.push('mapExport');
    }
}

function mapExport(event) {
    if (event.key === 'f' || event.key === 'F') {
        const jsonStr = JSON.stringify(mapSpots, null, '\t');
        const blob = new Blob([jsonStr], { type: "application/json" });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = "map_export.json";

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// Function to update the current button when the scene changes
function updateCurrentButton(sceneID) {
    const currentButton = document.querySelector('.map-button.current');
    if (currentButton) {
        currentButton.classList.remove('current');
    }

    const newCurrentButton = document.querySelector(`.map-button[data-id="${sceneID}"]`);
    if (newCurrentButton) {
        newCurrentButton.classList.add('current');
    }
}

// Show the map
function showMap() {
    document.getElementById("map-container").style.display = "block";
    document.getElementById("close-btn").style.display = "block";
    document.getElementById("show-map-btn").style.display = "none";
}

// Close the map
function closeMap() {
    document.getElementById("map-container").style.display = "none";
    document.getElementById("close-btn").style.display = "none";
    document.getElementById("show-map-btn").style.display = "block";
}