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

var addedListeners = [];

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
            if (data.default.editorMode) {
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
    loadMap(viewer, currentScene, mapData, data.default.editorMode); //currentScene sets what dot to have the :current-class

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
          if (data.default.editorMode) {
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

      if (data.default.editorMode) {
        editorMode();
        console.log("Current listeners: [" + addedListeners + "]");
      }
    });

    function loadJSONViewer(div, data) {
      $(div).jsonViewer(data, {
        rootCollapsable: false,
        collapsed: true
      });
    }

    function editorMode() {
      viewer.stopAutoRotate();

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

      // Dynamically create and append scenesInfo pre element
      let configInfoBox = document.getElementById('configInfo');
      if (!configInfoBox) {
        configInfoBox = document.createElement('pre');
        configInfoBox.id = 'configInfo';
        document.body.appendChild(configInfoBox);
      }

      // Dynamically create and append scenesInfo div element
      let helpInfoBox = document.getElementById('helpInfo');
      if (!helpInfoBox) {
        helpInfoBox = document.createElement('div');
        helpInfoBox.id = 'helpInfo';
        document.body.appendChild(helpInfoBox);

        helpInfoBox.innerHTML =
          `
        <ul>
        <li>Hold <b>H/I</b>, drag and release to add/remove Hotspots for scenes (<b>H</b>) and info (<b>I</b>). Closest when released will be removed.</li>
        <li>Press <b>E</b> to log the current scenes hotspots to the browsers console.</li>
        <li><b>Clicking on the map</b> will add the current scenes button to the map, if it isn't there already. Clicking somewhere else moves it.</li>
        <li>Press <b>F</b> to export the current tour-config (including dynamically added/removed hotspots) and the map buttons to config_export.json & map_export.json</li>
        <li>Before you have linked up your hotspots in your json you can change scenes with <b>J</b> and <b>K</b>.</li>
        <li>The topmost box with info about targetPitch and Yaw can be used to add those parameters to the hotspots to keep the viewer in the correct direction when traversing the tour. </li>
        <li>The leftmost box can be used to browse the current config.</li>
        </ul>
        `;
      }


      let isDragging = false;
      let isHKeyDown = false;
      let isIKeyDown = false;

      function handleKeyDown(event) {
        if (event.key === 'h' || event.key === 'H') {
          isHKeyDown = true;
        }
        if (event.key === 'i' || event.key === 'I') {
          isIKeyDown = true;
        }
      }

      function handleKeyUp(event) {
        if (event.key === 'h' || event.key === 'H') {
          isHKeyDown = false;
        }

        if (event.key === 'i' || event.key === 'I') {
          isIKeyDown = false;
        }

        // Go back one scene
        if (event.key === 'j' || event.key === 'J') {
          var next = getSceneKey(currentScene, 'previous');
          viewer.loadScene(next)
        }

        // Go forward one scene
        if (event.key === 'k' || event.key === 'k') {
          var next = getSceneKey(currentScene, 'next');
          viewer.loadScene(next)
        }

        function getSceneKey(currentSceneId, direction = 'next') {
          const scenes = viewer.getConfig().scenes;
          // Convert scenes object to an array
          const sceneEntries = Object.entries(scenes);
          // Find the index of the current sceneId
          const currentIndex = sceneEntries.findIndex(([sceneId, sceneData]) => sceneId === currentSceneId);

          // Calculate the next or previous index based on direction
          let newIndex;
          if (direction === 'next') {
            newIndex = (currentIndex + 1) % sceneEntries.length; // Wrap around if needed
          } else if (direction === 'previous') {
            newIndex = (currentIndex - 1 + sceneEntries.length) % sceneEntries.length; // Wrap around backwards
          } else {
            throw new Error('Invalid direction. Use "next" or "previous".');
          }
          // Return the sceneId (key) of the next or previous scene
          return sceneEntries[newIndex][0]; // The key is the first element of the entry
        }

        // console.log current hotspots in scene
        if (event.key === 'e' || event.key === 'E') {
          let currentHotspots = viewer.getConfig().hotSpots;

          // Don't reference since we want to remove some properties etc for export.
          let clonedHotspots = JSON.parse(JSON.stringify(currentHotspots));

          // Debug mode adds the hotSpot ID to text property, and saves orig in existingText
          // put this back for export
          clonedHotspots.forEach(hotspot => {
            if (hotspot.hasOwnProperty('existingText')) {
              hotspot.text = hotspot.existingText;
              delete hotspot.existingText;
            }
            else {
              delete hotspot.text;
            }

            if (hotspot.hasOwnProperty('div')) {
              delete hotspot.div;
            }
          });
          console.log(JSON.stringify(clonedHotspots, null, '\t'));
        }

        // download a export.json of the current total config
        if (event.key === 'f' || event.key === 'F') {

          let currentConfig = viewer.getConfig();
          // Don't reference since we want to remove some properties etc for export.
          let clonedConfig = JSON.parse(JSON.stringify(currentConfig));

          // Debug mode adds the hotSpot ID to text property, and saves orig in existingText
          // put this back for export
          Object.keys(clonedConfig.scenes).forEach(sceneId => {
            const scene = clonedConfig.scenes[sceneId];
            // Check if the scene has hotSpots
            if (scene.hotSpots && Array.isArray(scene.hotSpots)) {
              scene.hotSpots.forEach(hotspot => {
                if (hotspot.hasOwnProperty('existingText')) {
                  hotspot.text = hotspot.existingText;
                  delete hotspot.existingText;
                }
                else {
                  delete hotspot.text;
                }

                if (hotspot.hasOwnProperty('div')) {
                  delete hotspot.div;
                }
              });
            }
          });

          const config = {
            default: clonedConfig.default,
            scenes: clonedConfig.scenes
          };

          const jsonStr = JSON.stringify(config, null, '\t');
          const blob = new Blob([jsonStr], { type: "application/json" });

          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = "config_export.json";

          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }


      // Add the new event listeners
      if (!(addedListeners.includes('keydown'))) {
        window.addEventListener('keydown', handleKeyDown);
        addedListeners.push('keydown');
        //console.log('keydown listener added');
      }

      if (!(addedListeners.includes('keyup'))) {
        window.addEventListener('keyup', handleKeyUp);
        addedListeners.push('keyup');
        //console.log('keyup listener added');
      }

      viewer.off('mouseup');
      viewer.off('mousedown');
      viewer.off('zoomchange');

      let closenessThreshold = 2; // Remove hotspots this close to cursor

      viewer.on('mouseup', function () {
        isDragging = false;

        let hotspotConfig = {
          "pitch": parseFloat(viewer.getPitch().toFixed(2)),
          "yaw": parseFloat(viewer.getYaw().toFixed(2)),
          "type": "scene",
          "sceneId": ""
        };

        // Only add/remove the hotspot if the "H" key is held down
        if (isHKeyDown || isIKeyDown) {
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
            if (result) {
              //console.log(`Removed hotspot with ID: ${closestHotspot.id}`);
            }
            else {
              console.log(`Failed to remove hotspot with ID: ${closestHotspot.id}`);
            }

          } else {
            // Generate a unique ID for the new hotspot
            let existingIds = currentHotspots.map(hotspot => hotspot.id);
            let newId = findNextAvailableId(existingIds);

            // Assign the new ID to the hotspot config
            hotspotConfig.id = newId;
            hotspotConfig.text = "" + newId;

            if (isIKeyDown) {
              hotspotConfig.type = "info";
              delete hotspotConfig.sceneId;
            }
            // Add the new hotspot with a unique ID
            viewer.addHotSpot(hotspotConfig);
            //console.log("Added new hotspot with ID:", hotspotConfig.id);
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

      let pitch = parseFloat(viewer.getPitch().toFixed(2));
      let yaw = parseFloat(viewer.getYaw().toFixed(2));
      let hFov = viewer.getHfov();

      pitchYawInfoBox.style.display = 'block';

      function updateInfoBox() {
        pitchYawInfoBox.innerHTML = `Current scene: ${currentScene}<br>hFov: ${hFov}<br><br>"targetPitch": ${pitch},<br>"targetYaw": ${yaw}<br>"sceneId": ""`;
      }

      function updateConfigInfoBox() {
        let scenesJSON = viewer.getConfig();
        pitchYawInfoBox.style.display = 'block';
        loadJSONViewer("#configInfo", scenesJSON);
      }


      // TODO Why did this stop working? Works as expected if commented out.
      //if (!(addedListeners.includes('mousemove'))) {
        window.addEventListener('mousemove', function (event) {
          if (isDragging) {
            pitch = parseFloat(viewer.getPitch().toFixed(2));
            yaw = parseFloat(viewer.getYaw().toFixed(2));
            updateInfoBox();
          }
        });

        //addedListeners.push('mousemove');
        //console.log('mousemove listener added');
      //}

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

      loadMap(viewer, currentScene, mapData, data.default.editorMode); //sceneID sets what dot to have the :current-class

      viewer.stopAutoRotate(); // Don't autorotate when we load a new scene from inside a tour.

      // Don't need to autorotate in editorMode
      if (!data.default.editorMode) {
        var delayInMilliseconds = 2000; //2 second

        setTimeout(function () {
          viewer.startAutoRotate(); // wait, then start autoRotate
        }, delayInMilliseconds);
      }
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