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
var editorModeInitialized = false;
var currentEditorModeListeners = {
  keydown: null,
  keyup: null,
  mousemove: null,
  mouseup: null,
  mousedown: null,
  zoomchange: null,
  click: null
};
var viewer = null; // Global viewer variable

// Function to load the panorama and map data
function loadPanorama(panoramaData, mapData) {
  const urlParams = new URLSearchParams(window.location.search);
  var currentScene = urlParams.get('scene');  // Changed to use 'scene'
  
  // Check if we're on dev.html and force editor mode
  const isDevPage = window.location.pathname.includes('dev.html');
  
  // Load panorama JSON data
  loadJSON(panoramaData, function (data) {
    // Force editor mode if we're on dev.html
    if (isDevPage) {
      data.default.editorMode = true;
    }
    
    if (currentScene && data.scenes && data.scenes.hasOwnProperty(currentScene)) {
      data.default["firstScene"] = currentScene;
    }
    else {
      currentScene = data.default["firstScene"];
    }

         // Function to normalize yaw to -180 to +180 range
     function normalizeYaw(yaw) {
       while (yaw > 180) {
         yaw -= 360;
       }
       while (yaw < -180) {
         yaw += 360;
       }
       return yaw;
     }

     // Function to calculate targetPitch and targetYaw for hotspots
     function calculateTargetValues(hotspot, sceneKey, data) {
       if (hotspot.type === 'scene' && hotspot.sceneId) {
         // Always set targetPitch to 0 (horizon level)
         let targetPitch = 0;
         
         // Calculate targetYaw based on hotspot position relative to other hotspots
         let targetYaw = calculateTargetYawFromPosition(hotspot, sceneKey, data);
         
         return {
           targetPitch: targetPitch,
           targetYaw: Math.round(targetYaw * 100) / 100
         };
       }
       return null;
     }
     
     // Function to calculate targetYaw based on hotspot position
     function calculateTargetYawFromPosition(hotspot, sceneKey, data) {
       const currentScene = data.scenes[sceneKey];
       const targetScene = data.scenes[hotspot.sceneId];
       
       if (!currentScene || !targetScene || !currentScene.hotSpots || !targetScene.hotSpots) {
         return hotspot.yaw; // Fallback to current yaw
       }
       
       // Find the corresponding hotspot in the target scene that points back to current scene
       const backHotspot = targetScene.hotSpots.find(hs => hs.sceneId === sceneKey);
       
       if (backHotspot) {
         // Use the opposite direction of the back hotspot
         let targetYaw = backHotspot.yaw + 180;
         if (targetYaw > 180) {
           targetYaw -= 360;
         }
         return targetYaw;
       }
       
       // If no back hotspot found, use current hotspot yaw
       return hotspot.yaw;
     }

     // Loop through each scene and assign an 'id' to each hotspot based on its index
     for (let sceneKey in data.scenes) {
       if (data.scenes.hasOwnProperty(sceneKey)) {
         let scene = data.scenes[sceneKey];
         if (scene.hotSpots && Array.isArray(scene.hotSpots)) {
           scene.hotSpots.forEach((hotspot, index) => {
             hotspot.id = index; // Assign 'id' property as the array index
             
             // Normalize yaw values to -180 to +180 range
             if (hotspot.yaw !== undefined) {
               const oldYaw = hotspot.yaw;
               hotspot.yaw = normalizeYaw(hotspot.yaw);
               if (oldYaw !== hotspot.yaw) {
                 console.log(`Normalized yaw in scene ${sceneKey}, hotspot ${index}: ${oldYaw} → ${hotspot.yaw}`);
               }
             }
             
             // Add targetPitch and targetYaw if they don't exist (always, not just in editor mode)
             if (hotspot.type === 'scene' && !hotspot.hasOwnProperty('targetPitch') && !hotspot.hasOwnProperty('targetYaw')) {
               const targetValues = calculateTargetValues(hotspot, sceneKey, data);
               if (targetValues) {
                 hotspot.targetPitch = targetValues.targetPitch;
                 hotspot.targetYaw = targetValues.targetYaw;
                 if (data.default.editorMode) {
                   console.log(`Added target values for scene ${sceneKey}, hotspot ${index}: targetPitch=${targetValues.targetPitch}, targetYaw=${targetValues.targetYaw}`);
                 }
               }
             }
             
             if (data.default.editorMode) {
               let existingText = hotspot.text;
               let tooltipText = "" + index;
               
               // Add sceneId to tooltip if it exists
               if (hotspot.sceneId) {
                 tooltipText += " → " + hotspot.sceneId;
               }
               
               // Add target values to tooltip if they exist
               if (hotspot.targetPitch !== undefined || hotspot.targetYaw !== undefined) {
                 tooltipText += "<br>Target: ";
                 if (hotspot.targetPitch !== undefined) {
                   tooltipText += `P:${hotspot.targetPitch.toFixed(1)}`;
                 }
                 if (hotspot.targetYaw !== undefined) {
                   tooltipText += ` Y:${hotspot.targetYaw.toFixed(1)}`;
                 }
               }
               
               hotspot.text = tooltipText;
               if (existingText) {
                 hotspot.text = hotspot.text + "<br>" + existingText;
                 hotspot.existingText = existingText;
               }
             }
           });
         }
       }
     }

    // Destroy existing viewer if it exists
    if (viewer) {
      viewer.destroy();
    }
    
    // Initialize the pannellum viewer
    viewer = pannellum.viewer('panorama', data);
    
    // Only load map if mapData is provided
    if (mapData) {
      loadMap(viewer, currentScene, mapData, data.default.editorMode); //currentScene sets what dot to have the :current-class
    }

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
        
      }
    });

         function loadJSONViewer(div, data) {
       $(div).jsonViewer(data, {
         rootCollapsable: false,
         collapsed: true
       });
     }

     function removeEditorModeListeners() {
       // Remove window event listeners
       if (currentEditorModeListeners.keydown) {
         window.removeEventListener('keydown', currentEditorModeListeners.keydown);
         currentEditorModeListeners.keydown = null;
       }
       if (currentEditorModeListeners.keyup) {
         window.removeEventListener('keyup', currentEditorModeListeners.keyup);
         currentEditorModeListeners.keyup = null;
       }
       if (currentEditorModeListeners.mousemove) {
         window.removeEventListener('mousemove', currentEditorModeListeners.mousemove);
         currentEditorModeListeners.mousemove = null;
       }
       
       // Remove viewer event listeners only if viewer exists and is not destroyed
       if (viewer && typeof viewer.off === 'function') {
         try {
           if (currentEditorModeListeners.mouseup) {
             viewer.off('mouseup', currentEditorModeListeners.mouseup);
             currentEditorModeListeners.mouseup = null;
           }
           if (currentEditorModeListeners.mousedown) {
             viewer.off('mousedown', currentEditorModeListeners.mousedown);
             currentEditorModeListeners.mousedown = null;
           }
           if (currentEditorModeListeners.zoomchange) {
             viewer.off('zoomchange', currentEditorModeListeners.zoomchange);
             currentEditorModeListeners.zoomchange = null;
           }
           if (currentEditorModeListeners.click) {
             viewer.off('click', currentEditorModeListeners.click);
             currentEditorModeListeners.click = null;
           }
         } catch (error) {
           // Viewer might be destroyed, ignore errors
           console.log('Viewer event listeners already removed or viewer destroyed');
         }
       }
     }

             function editorMode() {
        // Remove any existing editor mode listeners first
        removeEditorModeListeners();
        
        viewer.stopAutoRotate();
       
       viewer.stopAutoRotate();

       console.log("Loaded scene: " + currentScene);
       
       // Remove any existing debug indicator and recreate it
       let debugIndicator = document.querySelector('.pnlm-sprite.pnlm-hot-spot-debug-indicator');
       if (debugIndicator) {
         debugIndicator.style.display = 'block';
       }

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
        <li>When creating info hotspots with <b>I</b>, you will be prompted to enter text for the hotspot.</li>
        <li>Press <b>R</b> to edit the closest info hotspot near your current view position.</li>
        <li>Press <b>T</b> to toggle all info boxes (pitch/yaw, JSON viewer, and help) on/off.</li>
        <li>Hold <b>Q</b>, drag and release to move existing hotspots to a new position.</li>
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
      let isQKeyDown = false;
      let draggedHotspot = null;
      let isProcessingMouseUp = false;
      let lastClickTime = 0;
      let lastClickPosition = null;
      let infoBoxesHidden = false;

      function handleKeyDown(event) {
        if (event.key === 'h' || event.key === 'H') {
          isHKeyDown = true;
        }
        if (event.key === 'i' || event.key === 'I') {
          isIKeyDown = true;
        }
        if (event.key === 'q' || event.key === 'Q') {
          isQKeyDown = true;
        }
        if (event.key === 'r' || event.key === 'R') {
          // Edit mode for hotspots - find closest info hotspot and edit it
          let currentHotspots = viewer.getConfig().hotSpots;
          let currentPitch = parseFloat(viewer.getPitch().toFixed(2));
          let currentYaw = parseFloat(viewer.getYaw().toFixed(2));
          
          let targetHotspot = null;
          let closestDistance = Infinity;
          
          currentHotspots.forEach((hotspot) => {
            if (hotspot.type === "info") {
              let pitchDiff = Math.abs(hotspot.pitch - currentPitch);
              let yawDiff = Math.abs(hotspot.yaw - currentYaw);
              if (yawDiff > 180) {
                yawDiff = 360 - yawDiff;
              }
              let distance = Math.sqrt(pitchDiff ** 2 + yawDiff ** 2);
              
              if (distance < closestDistance && distance < 15) { // Within 15 degrees
                closestDistance = distance;
                targetHotspot = hotspot;
              }
            }
          });
          
          if (targetHotspot) {
            console.log("Editing info hotspot:", targetHotspot.id);
            
            // Get current text (remove debug info if present)
            let currentText = targetHotspot.text || "";
            if (targetHotspot.existingText) {
              currentText = targetHotspot.existingText;
            }
            
            // Remove debug prefix if present (ID → sceneId format)
            if (currentText.includes(" → ")) {
              currentText = currentText.split(" → ")[1] || "";
            }
            
            // Show prompt with current text
            let newText = prompt("Redigera text för info hotspot:", currentText);
            if (newText !== null) {
              if (newText.trim() !== "") {
                // Update the hotspot text
                targetHotspot.text = newText.trim();
                if (targetHotspot.existingText) {
                  targetHotspot.existingText = newText.trim();
                }
                
                // Remove and re-add the hotspot to update the display
                viewer.removeHotSpot(targetHotspot.id);
                viewer.addHotSpot(targetHotspot);
                console.log("Hotspot updated with new text:", newText.trim());
              } else {
                // Remove hotspot if text is empty
                viewer.removeHotSpot(targetHotspot.id);
                console.log("Hotspot removed due to empty text");
              }
              updateConfigInfoBox();
            }
          } else {
            console.log("No info hotspot found nearby");
          }
        }
        
        // Toggle all info boxes visibility
        if (event.key === 't' || event.key === 'T') {
          let pitchYawInfoBox = document.getElementById('pitchYawInfo');
          let configInfoBox = document.getElementById('configInfo');
          let helpInfoBox = document.getElementById('helpInfo');
          
          infoBoxesHidden = !infoBoxesHidden;
          
          if (infoBoxesHidden) {
            // Hide all
            if (pitchYawInfoBox) pitchYawInfoBox.style.display = 'none';
            if (configInfoBox) configInfoBox.style.display = 'none';
            if (helpInfoBox) helpInfoBox.style.display = 'none';
            console.log("All info boxes hidden");
          } else {
            // Show all
            if (pitchYawInfoBox) pitchYawInfoBox.style.display = 'block';
            if (configInfoBox) configInfoBox.style.display = 'block';
            if (helpInfoBox) helpInfoBox.style.display = 'block';
            console.log("All info boxes shown");
          }
        }
      }

      function handleKeyUp(event) {
        if (event.key === 'h' || event.key === 'H') {
          isHKeyDown = false;
        }

        if (event.key === 'i' || event.key === 'I') {
          isIKeyDown = false;
        }

        if (event.key === 'q' || event.key === 'Q') {
          isQKeyDown = false;
          draggedHotspot = null;
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
            // Keep text for info hotspots that don't have existingText (newly created ones)
            else if (hotspot.type === "info" && hotspot.text) {
              // Keep the text as is
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
                // Keep text for info hotspots that don't have existingText (newly created ones)
                else if (hotspot.type === "info" && hotspot.text) {
                  // Keep the text as is
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


                           // Store and add event listeners
        currentEditorModeListeners.keydown = handleKeyDown;
        currentEditorModeListeners.keyup = handleKeyUp;
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

      let closenessThreshold = 2; // Remove hotspots this close to cursor

             const mouseupHandler = function () {
        if (isProcessingMouseUp) return; // Prevent multiple executions
        isProcessingMouseUp = true;
        isDragging = false;

        // If we were dragging a hotspot, update its position
        if (draggedHotspot) {
          let newPitch = parseFloat(viewer.getPitch().toFixed(2));
          let newYaw = parseFloat(viewer.getYaw().toFixed(2));
          
          // Remove the old hotspot
          viewer.removeHotSpot(draggedHotspot.id);
          
          // Create new hotspot config with updated position
          let updatedHotspot = {
            ...draggedHotspot,
            pitch: newPitch,
            yaw: newYaw
          };
          
          // Add the updated hotspot back
          viewer.addHotSpot(updatedHotspot);
          
          draggedHotspot = null;
        }
        // Only add/remove the hotspot if the "H" or "I" key is held down
        else if (isHKeyDown || isIKeyDown) {
          let hotspotConfig = {
            "pitch": parseFloat(viewer.getPitch().toFixed(2)),
            "yaw": parseFloat(viewer.getYaw().toFixed(2)),
            "type": "scene",
            "sceneId": ""
          };
          let currentHotspots = viewer.getConfig().hotSpots;
          let closestHotspot = null;
          let closestDistance = Infinity;

                     // Calculate the distance between the new hotspot and each current hotspot
           currentHotspots.forEach((hotspot, index) => {
             let pitchDiff = Math.abs(hotspot.pitch - hotspotConfig.pitch);
             
             // Handle yaw wrapping (360 degrees)
             let yawDiff = Math.abs(hotspot.yaw - hotspotConfig.yaw);
             if (yawDiff > 180) {
               yawDiff = 360 - yawDiff; // Take the shorter path around the circle
             }

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
             let tooltipText = "" + newId;
             
             // Add sceneId to tooltip if it exists
             if (hotspotConfig.sceneId) {
               tooltipText += " → " + hotspotConfig.sceneId;
             }
             
             hotspotConfig.text = tooltipText;

            if (isIKeyDown) {
              hotspotConfig.type = "info";
              delete hotspotConfig.sceneId;
              
              // Prompt user for text input for info hotspots
              let userText = prompt("Skriv in text för info hotspot:");
              if (userText !== null && userText.trim() !== "") {
                hotspotConfig.text = userText.trim();
                // Reset I key state after successful creation
                isIKeyDown = false;
              } else {
                // If user cancels or enters empty text, remove the hotspot and reset I key state
                isIKeyDown = false;
                return;
              }
            }
            // Add the new hotspot with a unique ID
            viewer.addHotSpot(hotspotConfig);
            //console.log("Added new hotspot with ID:", hotspotConfig.id);
          }
        }
        updateConfigInfoBox();
        isProcessingMouseUp = false; // Reset flag after processing
      };
      
      // Store and add mouseup listener
      currentEditorModeListeners.mouseup = mouseupHandler;
      viewer.on('mouseup', mouseupHandler);

      // Add click handler for detecting double-clicks on info hotspots
      const clickHandler = function (event) {
        if (!data.default.editorMode) return; // Only in editor mode
        
        console.log("Click detected on viewer"); // Debug log
        
        // Get current time and position
        let currentTime = new Date().getTime();
        let currentPitch = parseFloat(viewer.getPitch().toFixed(2));
        let currentYaw = parseFloat(viewer.getYaw().toFixed(2));
        let currentPosition = { pitch: currentPitch, yaw: currentYaw };
        
        console.log("Current position - Pitch:", currentPitch, "Yaw:", currentYaw); // Debug log
        
        // Check if this is a double-click (within 500ms and similar position)
        let isDoubleClick = false;
        if (lastClickTime > 0 && 
            (currentTime - lastClickTime) < 500 && 
            lastClickPosition &&
            Math.abs(currentPosition.pitch - lastClickPosition.pitch) < 5 &&
            Math.abs(currentPosition.yaw - lastClickPosition.yaw) < 5) {
          isDoubleClick = true;
          console.log("Double-click detected!"); // Debug log
        }
        
        // Update last click info
        lastClickTime = currentTime;
        lastClickPosition = currentPosition;
        
        if (isDoubleClick) {
          // Find the closest hotspot at this position
          let currentHotspots = viewer.getConfig().hotSpots;
          console.log("Current hotspots:", currentHotspots); // Debug log
          
          let targetHotspot = null;
          let closestDistance = Infinity;
          
          currentHotspots.forEach((hotspot) => {
            let pitchDiff = Math.abs(hotspot.pitch - currentPosition.pitch);
            let yawDiff = Math.abs(hotspot.yaw - currentPosition.yaw);
            if (yawDiff > 180) {
              yawDiff = 360 - yawDiff;
            }
            let distance = Math.sqrt(pitchDiff ** 2 + yawDiff ** 2);
            
            console.log("Hotspot", hotspot.id, "distance:", distance, "type:", hotspot.type); // Debug log
            
            if (distance < closestDistance && distance < 10) { // Within 10 degrees
              closestDistance = distance;
              targetHotspot = hotspot;
            }
          });
          
          console.log("Target hotspot:", targetHotspot); // Debug log
          
          if (targetHotspot && targetHotspot.type === "info") {
            console.log("Editing info hotspot:", targetHotspot.id); // Debug log
            
            // Get current text (remove debug info if present)
            let currentText = targetHotspot.text || "";
            if (targetHotspot.existingText) {
              currentText = targetHotspot.existingText;
            }
            
            // Remove debug prefix if present (ID → sceneId format)
            if (currentText.includes(" → ")) {
              currentText = currentText.split(" → ")[1] || "";
            }
            
            console.log("Current text:", currentText); // Debug log
            
            // Show prompt with current text
            let newText = prompt("Redigera text för info hotspot:", currentText);
            if (newText !== null) {
              if (newText.trim() !== "") {
                // Update the hotspot text
                targetHotspot.text = newText.trim();
                if (targetHotspot.existingText) {
                  targetHotspot.existingText = newText.trim();
                }
                
                // Remove and re-add the hotspot to update the display
                viewer.removeHotSpot(targetHotspot.id);
                viewer.addHotSpot(targetHotspot);
                console.log("Hotspot updated with new text:", newText.trim()); // Debug log
              } else {
                // Remove hotspot if text is empty
                viewer.removeHotSpot(targetHotspot.id);
                console.log("Hotspot removed due to empty text"); // Debug log
              }
              updateConfigInfoBox();
            }
          } else {
            console.log("No info hotspot found at click position"); // Debug log
          }
          
          // Reset click tracking after double-click
          lastClickTime = 0;
          lastClickPosition = null;
        }
      };
      
      // Store and add click listener
      currentEditorModeListeners.click = clickHandler;
      viewer.on('click', clickHandler);

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

      const mousedownHandler = function () {
        isDragging = true;
        
                 // If Q key is held down, find the closest hotspot to start dragging
         if (isQKeyDown) {
           let currentHotspots = viewer.getConfig().hotSpots;
           let closestHotspot = null;
           let closestDistance = Infinity;
           let currentPitch = parseFloat(viewer.getPitch().toFixed(2));
           let currentYaw = parseFloat(viewer.getYaw().toFixed(2));

           

                       // Calculate the distance between the current position and each hotspot
            currentHotspots.forEach((hotspot, index) => {
              let pitchDiff = Math.abs(hotspot.pitch - currentPitch);
              
              // Handle yaw wrapping (360 degrees)
              let yawDiff = Math.abs(hotspot.yaw - currentYaw);
              if (yawDiff > 180) {
                yawDiff = 360 - yawDiff; // Take the shorter path around the circle
              }
              
              let distance = Math.sqrt(pitchDiff ** 2 + yawDiff ** 2);

              

              if (distance < closestDistance) {
                closestDistance = distance;
                closestHotspot = hotspot;
              }
            });

                       // If we found a hotspot within reasonable distance, start dragging it
            if (closestDistance < 20) { // Larger threshold for dragging
              draggedHotspot = closestHotspot;
            }
         }
      };
      
      // Store and add mousedown listener
      currentEditorModeListeners.mousedown = mousedownHandler;
      viewer.on('mousedown', mousedownHandler);

      let pitch = parseFloat(viewer.getPitch().toFixed(2));
      let yaw = parseFloat(viewer.getYaw().toFixed(2));
      let hFov = viewer.getHfov();

      pitchYawInfoBox.style.display = 'block';

      function updateInfoBox() {
        if (!infoBoxesHidden) {
          pitchYawInfoBox.innerHTML = `Current scene: ${currentScene}<br>hFov: ${hFov}<br><br>"targetPitch": ${pitch},<br>"targetYaw": ${yaw}<br>"sceneId": ""`;
        }
      }

      function updateConfigInfoBox() {
        let scenesJSON = viewer.getConfig();
        if (!infoBoxesHidden) {
          pitchYawInfoBox.style.display = 'block';
          loadJSONViewer("#configInfo", scenesJSON);
        }
      }


       function handleMouseMove(event) {
         if (isDragging) {
           pitch = parseFloat(viewer.getPitch().toFixed(2));
           yaw = parseFloat(viewer.getYaw().toFixed(2));
           updateInfoBox();
         }
       }

      const zoomchangeHandler = function (newHfov) {
        hFov = parseFloat(newHfov.toFixed(2)); // Store the new hFov value
        updateInfoBox();
      };

      // Store and add mousemove and zoomchange listeners
      currentEditorModeListeners.mousemove = handleMouseMove;
      currentEditorModeListeners.zoomchange = zoomchangeHandler;
      window.addEventListener('mousemove', handleMouseMove);
      viewer.on("zoomchange", zoomchangeHandler);

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
      
      // Re-enable editormode for new scene if in editormode
      if (data.default.editorMode) {
        // Wait a bit for the scene to fully load, then re-enable editormode
        setTimeout(function() {
          editorMode();
        }, 100);
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