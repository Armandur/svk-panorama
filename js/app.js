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

    // Loop through each scene and assign an 'id' to each hotspot based on its index
    for (let sceneKey in data.scenes) {
      if (data.scenes.hasOwnProperty(sceneKey)) {
        let scene = data.scenes[sceneKey];
        if (scene.hotSpots && Array.isArray(scene.hotSpots)) {
          scene.hotSpots.forEach((hotspot, index) => {
            hotspot.id = index; // Assign 'id' property as the array index
            if (data.default.myHotSpotDebug) {
              let existingText = hotspot.text;
              hotspot.text = "" + index;
              if (existingText) {
                hotspot.text = hotspot.text + "<br>" + existingText;
                hotspot.existingText = existingText;
              }
            }
          });
        }
      }
    }

    // Initialize the pannellum viewer
    const viewer = pannellum.viewer('panorama', data);
    loadMap(viewer, currentScene, mapData, data.default.myHotSpotDebug); //currentScene sets what dot to have the :current-class

    // When finished loading a scene
    viewer.on('load', function () {
      //When finished loading, start preloading scenes linked to from this scene.
      const currentConfig = viewer.getConfig();
      let nextUrls = [];
      //console.log(currentConfig);
      for (hotspot in currentConfig.hotSpots) {
        if (currentConfig.hotSpots[hotspot].sceneId) //Only if hotSpot has a sceneId (and thus is of type scene, not info)
        {
          //console.log(currentConfig.hotSpots[hotspot].sceneId);
          //console.log(currentConfig.scenes[currentConfig.hotSpots[hotspot].sceneId]);
          nextUrls.push(currentConfig.scenes[currentConfig.hotSpots[hotspot].sceneId].panorama);
        }

      }

      function preLoadImage(url) {
        const img = new Image();

        img.onload = function () {
          // This code runs when the image has fully loaded
          if (data.default.myHotSpotDebug) {
            console.log("Preloaded url: " + url);
          }
        };

        img.onerror = function () {
          // Optional: Handle image loading error
          console.error("Failed to load image at url: " + url);
        };

        img.src = url; // Set the image source after setting the onload event
      }

      nextUrls.forEach(url => preLoadImage(url));

      if (data.default.myHotSpotDebug) {
        debugMode();
      }
    });

    function loadJSONViewer(div, data) {
      $(div).jsonViewer(data, {
        rootCollapsable: false,
        collapsed: true
      });
    }

    function debugMode() {
      console.log("Loaded scene: " + currentScene);
      document.querySelector('.pnlm-sprite.pnlm-hot-spot-debug-indicator').style.display = 'block';

      // Dynamically create and append pitchYawInfo div
      let pitchYawInfoBox = document.getElementById('pitchYawInfo');
      if (!pitchYawInfoBox) {
        pitchYawInfoBox = document.createElement('div');
        pitchYawInfoBox.id = 'pitchYawInfo';
        document.body.appendChild(pitchYawInfoBox);
      }
      pitchYawInfoBox.style.display = 'block';
      pitchYawInfoBox.innerHTML = `${currentScene}<br>"targetPitch": ${viewer.getPitch().toFixed(2)},<br>"targetYaw": ${viewer.getYaw().toFixed(2)}`;

      // Dynamically create and append scenesInfo pre element
      let scenesInfoBox = document.getElementById('scenesInfo');
      if (!scenesInfoBox) {
        scenesInfoBox = document.createElement('pre');
        scenesInfoBox.id = 'scenesInfo';
        document.body.appendChild(scenesInfoBox);
      }

      function resetEventListeners() {
        // Remove existing listeners if they exist
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);

        // Add the new event listeners
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        viewer.off('mouseup');
        viewer.off('mousedown');
        viewer.off('zoomchange');
      }

      let isDragging = false;
      let isHKeyDown = false;

      function handleKeyDown(event) {
        if (event.key === 'h' || event.key === 'H') {
          isHKeyDown = true;
          hasPressedH = true; // "H" has been pressed at least once
        }
      }

      function handleKeyUp(event) {
        if (event.key === 'h' || event.key === 'H') {
          isHKeyDown = false;
        }

        if (event.key === 'e' || event.key === 'E') {
          let currentHotspots = viewer.getConfig().hotSpots;
          currentHotspots.forEach(hotspot => {
            if (hotspot.hasOwnProperty('existingText')) {
              hotspot.text = hotspot.existingText;
              delete hotspot.existingText;
            }
          });
          console.log(JSON.stringify(currentHotspots, null, 2));
        }
      }

      resetEventListeners();

      let closenessThreshold = 2; // Remove hotspots this close to cursor

      viewer.on('mouseup', function () {
        let hotspotConfig = {
          "pitch": parseFloat(viewer.getPitch().toFixed(2)),
          "yaw": parseFloat(viewer.getYaw().toFixed(2)),
          "type": "scene",
          "sceneId": ""
        };

        // Only add/remove the hotspot if the "H" key is held down
        if (isHKeyDown) {
          let currentHotspots = viewer.getConfig().hotSpots;
          let closestHotspot = null;
          let closestDistance = Infinity;

          // Calculate the distance between the new hotspot and each current hotspot
          currentHotspots.forEach((hotspot, index) => {
            let pitchDiff = Math.abs(hotspot.pitch - hotspotConfig.pitch);
            let yawDiff = Math.abs(hotspot.yaw - hotspotConfig.yaw);

            // Simple Euclidean-like distance (in this context)
            let distance = Math.sqrt(pitchDiff ** 2 + yawDiff ** 2);

            // Check if this hotspot is closer than the closest we've found
            if (distance < closestDistance) {
              closestDistance = distance;
              closestHotspot = hotspot;
            }
          });

          // If the closest hotspot is within the threshold
          if (closestDistance < closenessThreshold) {
            // Remove the closest hotspot by its id
            result = viewer.removeHotSpot(closestHotspot.id);
            console.log(`Removed hotspot with ID: ${closestHotspot.id}`);
            console.log(result);
            hasPressedH = false;
          } else {
            // Generate a unique ID for the new hotspot
            let existingIds = currentHotspots.map(hotspot => hotspot.id);
            let newId = findNextAvailableId(existingIds);

            // Assign the new ID to the hotspot config
            hotspotConfig.id = newId;
            hotspotConfig.text = "" + newId;

            // Add the new hotspot with a unique ID
            viewer.addHotSpot(hotspotConfig);
            console.log("Added new hotspot with ID:", hotspotConfig.id);
          }
        }
        updateConfigInfoBox();
      });

      // Function to find the next available ID
      function findNextAvailableId(existingIds) {
        existingIds.sort((a, b) => a - b); // Sort IDs numerically

        // Check for the first missing index (ID) in the sorted array
        for (let i = 0; i < existingIds.length; i++) {
          if (existingIds[i] !== i) {
            return i; // Return the first missing index
          }
        }

        // If no IDs are missing, return the next largest integer
        return existingIds.length;
      }

      viewer.on('mousedown', function () {
        isDragging = true;
      });

      let pitch = viewer.getPitch();
      let yaw = viewer.getYaw();
      let hFov = viewer.getHfov();

      pitchYawInfoBox.style.display = 'block';

      function updateInfoBox() {
        pitchYawInfoBox.innerHTML = `Current scene: ${currentScene}<br>hFov: ${hFov}<br>"targetPitch": ${viewer.getPitch().toFixed(2)},<br>"targetYaw": ${viewer.getYaw().toFixed(2)}`;
      }

      function updateConfigInfoBox() {
        let scenesJSON = viewer.getConfig();
        pitchYawInfoBox.style.display = 'block';
        loadJSONViewer("#scenesInfo", scenesJSON);
      }

      window.addEventListener('mousemove', function (event) {
        if (isDragging) {
          pitch = viewer.getPitch();
          yaw = viewer.getYaw();
          updateInfoBox();
        }
      });

      viewer.on("zoomchange", function (newHfov) {
        hFov = parseFloat(newHfov.toFixed(2)); // Store the new hFov value
        updateInfoBox();
      });

      updateConfigInfoBox();
    }

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

      loadMap(viewer, currentScene, mapData, data.default.myHotSpotDebug); //sceneID sets what dot to have the :current-class

      viewer.stopAutoRotate(); // Don't autorotate when we load a new scene from inside a tour.
      var delayInMilliseconds = 2000; //2 second

      setTimeout(function () {
        viewer.startAutoRotate(); // wait, then start autoRotate
      }, delayInMilliseconds);
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
        loadMap(viewer, newSceneId, mapData, data.default.myHotSpotDebug);

        currentScene = newSceneId; // Update current scene to reflect the URL change
      }
    };
  });
}