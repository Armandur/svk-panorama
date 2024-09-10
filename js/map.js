function loadMap(viewer, current, json) {
    const timestamp = new Date().getTime(); //Don't cache the jsons
    fetch(json + "?t=" + timestamp)
        .then(response => response.json())
        .then(data => {
			//console.log(data);
            data.scenes.forEach(scene => {  // Changed to scenes
                const button = document.createElement('a');
                button.className = 'map-button';  // Changed class to map-button
                button.style.top = scene.position.y + 'px';
                button.style.left = scene.position.x + 'px';
                button.dataset.id = scene.id;

                // Click event to load the selected scene in the viewer
                button.addEventListener('click', function (event) {
                    event.preventDefault();  // Prevent the default anchor action
                    
                    if (scene.id !== current) {
                        viewer.loadScene(scene.id);  // Load the new scene
                        console.log(`Clicked scene: ${scene.id} on map`);
                    }
                });

                // Add .current class if it's the current scene
                if (scene.id === current) {
                    button.classList.add('current');
                }

                document.getElementById('map-container').appendChild(button);
            });
        })
        .catch(error => {
            console.error('Error loading map data:', error);
        });
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