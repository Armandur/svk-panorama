function loadJSON(path, callback) {
  const timestamp = new Date().getTime(); //Don't cache the jsons
  fetch(path + "?t=" + timestamp)
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
      data.default["firstScene"] = currentScene;
    }
    else {
      currentScene = data.default["firstScene"];
    }

    // Initialize the pannellum viewer
    const viewer = pannellum.viewer('panorama', data);
    loadMap(viewer, currentScene, mapData); //currentScene sets what dot to have the :current-class

    // When finished loading a scene
    viewer.on('load', function () {
      if (data.default.myHotSpotDebug) {
        console.log("Loaded scene: " + currentScene);
        document.querySelector('.pnlm-sprite.pnlm-hot-spot-debug-indicator').style.display = 'block';

        viewer.on('mouseup', function () {
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

    // Attach to on scenechange events to add sceneID to the url as well as history in the browser
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
      currentScene = sceneID;

      if (data.default.myHotSpotDebug) {
        console.log(`Loading scene: ${sceneID}`);
      }

      loadMap(viewer, currentScene, mapData); //sceneID sets what dot to have the :current-class
    });

    //Handling for backing and loading scene when that happens
    window.onpopstate = function () {
      const updatedUrlParams = new URLSearchParams(window.location.search);
      var newSceneId = updatedUrlParams.get('scene');

      if (!newSceneId) {
        newSceneId = data.default["firstScene"];
      }

      if (newSceneId && newSceneId !== currentScene) {
        viewer.loadScene(newSceneId); // Load the new scene based on URL

        if (data.default.myHotSpotDebug) {
          console.log(`Back button pressed, loading scene: ${newSceneId}`);
        }

        // Update the map button's :current class
        loadMap(viewer, newSceneId, mapData);

        currentScene = newSceneId; // Update current scene to reflect the URL change
      }
    };
  });
}