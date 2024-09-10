function loadJSON(path, callback) {
	fetch(path)
	  .then(response => {
		if (!response.ok) {
		  throw new Error('Network response was not ok');
		}
		return response.json();
	  })
	  .then(data => {
		callback(data);
	  })
	  .catch(error => {
		console.error('There was a problem fetching the JSON file:', error);
	  });
  }

  // Function to load the panorama and map data
function loadPanorama(panoramaData, mapData) {
    const urlParams = new URLSearchParams(window.location.search);
    var currentScene = urlParams.get('scene');  // Changed to use 'scene'
    // Load the map JSON data and create the map
    // Load panorama JSON data
    loadJSON(panoramaData, function (data) {
        if (currentScene && data.scenes && data.scenes.hasOwnProperty(currentScene)) {
            data["firstScene"] = currentScene;
        }

        // Initialize the pannellum viewer
        const viewer = pannellum.viewer('panorama', data);
        loadMap(viewer, currentScene, mapData); //currentScene sets what dot to have the :current-class

        // Handle scene changes
        viewer.on('scenechange', function (sceneID) {
            const url = new URL(window.location);
            const scene = url.searchParams.get('scene');
            
            // Update the URL with the new scene ID
            if (scene) {
                url.searchParams.set('scene', sceneID);  // Update the scene parameter
            } else {
                url.searchParams.append('scene', sceneID);  // Add the scene parameter
            }

            window.history.pushState({}, '', url);
            console.log(`Loading scene: ${sceneID}`);

            // Update the map button with the current scene
            updateCurrentButton(sceneID);
            loadMap(viewer, sceneID, mapData); //currentScene sets what dot to have the :current-class

			if(data.default.myHotSpotDebug){
				document.querySelector('.pnlm-sprite.pnlm-hot-spot-debug-indicator').style.display = 'block';
	
				viewer.on('mouseup', function() {
					console.log(
				`
				{
					"pitch": ${viewer.getPitch()},
					"yaw": ${viewer.getYaw()},
					"type": "scene",
					"sceneId": ""
				},
				`
					);
				})
			}
        });
    });
}