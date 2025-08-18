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
        <li>Hold <b>H/I/U</b>, drag and release to add/remove Hotspots for scenes (<b>H</b>), info (<b>I</b>), and URLs (<b>U</b>). Closest when released will be removed.</li>
        <li>When creating scene hotspots with <b>H</b>, you will be prompted to enter the target scene ID. A back-connection will be automatically created.</li>
        <li>When creating info hotspots with <b>I</b>, you will be prompted to enter text for the hotspot.</li>
        <li>When creating URL hotspots with <b>U</b>, you will be prompted to enter URL and choose if it opens in same window.</li>
        <li>Press <b>R</b> to edit the closest hotspot near your current view position (info hotspots: edit text, scene hotspots: edit target scene ID).</li>
        <li>Press <b>T</b> to add/edit text attribute to the closest hotspot, or title attribute to current scene if no hotspot is nearby.</li>
        <li>Press <b>X</b> to toggle all info boxes (pitch/yaw, JSON viewer, and help) on/off.</li>
        <li>Hold <b>Q</b>, drag and release to move existing hotspots to a new position.</li>
        <li>Press <b>E</b> to log the current scenes hotspots to the browsers console.</li>
        <li><b>Clicking on the map</b> will add the current scenes button to the map, if it isn't there already. Clicking somewhere else moves it.</li>
        <li>Press <b>F</b> to export the current tour-config (including dynamically added/removed hotspots) and the map buttons to config_export.json & map_export.json</li>
        <li>Before you have linked up your hotspots in your json you can change scenes with <b>J</b> and <b>K</b>.</li>
        <li>Press <b>L</b> to toggle the tour selector menu.</li>
        <li>The topmost box with info about targetPitch and Yaw can be used to add those parameters to the hotspots to keep the viewer in the correct direction when traversing the tour. </li>
        <li>The leftmost box can be used to browse the current config.</li>
        </ul>
        `;
      }


      let isDragging = false;
      let isHKeyDown = false;
      let isIKeyDown = false;
      let isQKeyDown = false;
      let isUKeyDown = false;
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
        if (event.key === 'u' || event.key === 'U') {
          isUKeyDown = true;
        }
        
        // Toggle all info boxes visibility
        if (event.key === 'x' || event.key === 'X') {
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

        if (event.key === 'r' || event.key === 'R') {
          // Edit mode for hotspots - find closest hotspot and edit it
          let currentHotspots = viewer.getConfig().hotSpots;
          let currentPitch = parseFloat(viewer.getPitch().toFixed(2));
          let currentYaw = parseFloat(viewer.getYaw().toFixed(2));
          
          let targetHotspot = null;
          let closestDistance = Infinity;
          
          currentHotspots.forEach((hotspot) => {
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
          });
          
          if (targetHotspot) {
            console.log("Editing hotspot:", targetHotspot.id, "type:", targetHotspot.type);
            
            if (targetHotspot.type === "info") {
              // Edit info hotspot
              let currentText = targetHotspot.text || "";
              if (targetHotspot.existingText) {
                currentText = targetHotspot.existingText;
              }
              
              // Remove debug prefix if present (ID → sceneId format)
              if (currentText.includes(" → ")) {
                currentText = currentText.split(" → ")[1] || "";
              }
              
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
                  console.log("Info hotspot updated with new text:", newText.trim());
                } else {
                  // Remove hotspot if text is empty
                  viewer.removeHotSpot(targetHotspot.id);
                  console.log("Info hotspot removed due to empty text");
                }
                updateConfigInfoBox();
              }
            } else if (targetHotspot.type === "scene") {
              // Edit scene hotspot
              let currentSceneId = targetHotspot.sceneId || "";
              let newSceneId = prompt("Redigera scene ID för scene hotspot:", currentSceneId);
              
              if (newSceneId !== null) {
                if (newSceneId.trim() !== "") {
                  newSceneId = newSceneId.trim();
                  
                  // Check if target scene exists
                  const config = viewer.getConfig();
                  if (!config.scenes[newSceneId]) {
                    alert(`Scene "${newSceneId}" does not exist!`);
                    return;
                  }

                  // Check if connection already exists (excluding current one)
                  const existingConnection = currentHotspots.find(hs => 
                    hs.type === "scene" && hs.sceneId === newSceneId && hs.id !== targetHotspot.id
                  );
                  
                  if (existingConnection) {
                    alert(`Connection to scene "${newSceneId}" already exists!`);
                    return;
                  }

                  // Remove old back-connection if it exists
                  if (currentSceneId && config.scenes[currentSceneId]) {
                    removeBackConnection(currentSceneId, currentScene);
                  }

                  // Update scene hotspot
                  targetHotspot.sceneId = newSceneId;
                  targetHotspot.text = "" + targetHotspot.id + " → " + newSceneId;
                  
                  // Create new back-connection
                  createBackConnection(newSceneId, currentScene);
                  
                  // Remove and re-add the hotspot to update the display
                  viewer.removeHotSpot(targetHotspot.id);
                  viewer.addHotSpot(targetHotspot);
                  console.log("Scene hotspot updated to connect to:", newSceneId);
                                 } else {
                   // Remove hotspot if scene ID is empty
                   if (currentSceneId && config.scenes[currentSceneId]) {
                     const removeBackConnection = confirm(
                       `Remove scene hotspot.\n\n` +
                       `Do you also want to remove the corresponding back-connection from scene "${currentSceneId}"?\n\n` +
                       `OK = Remove both\nCancel = Remove only this hotspot`
                     );
                     
                     if (removeBackConnection) {
                       removeBackConnection(currentSceneId, currentScene);
                     }
                   }
                   viewer.removeHotSpot(targetHotspot.id);
                   console.log("Scene hotspot removed due to empty scene ID");
                 }
                updateConfigInfoBox();
              }
            }
          } else {
            console.log("No hotspot found nearby");
          }
        }
        
        // Add text attribute to closest hotspot or title to current scene
        if (event.key === 't' || event.key === 'T') {
          let currentHotspots = viewer.getConfig().hotSpots;
          let currentPitch = parseFloat(viewer.getPitch().toFixed(2));
          let currentYaw = parseFloat(viewer.getYaw().toFixed(2));
          
          let targetHotspot = null;
          let closestDistance = Infinity;
          
          currentHotspots.forEach((hotspot) => {
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
          });
          
          if (targetHotspot) {
            // Edit hotspot text attribute
            let currentText = targetHotspot.text || "";
            let newText = prompt("Add text attribute to hotspot:", currentText);
            if (newText !== null) {
              if (newText.trim() !== "") {
                targetHotspot.text = newText.trim();
              } else {
                // Remove text attribute if empty
                delete targetHotspot.text;
              }
              
              // Remove and re-add the hotspot to update the display
              viewer.removeHotSpot(targetHotspot.id);
              viewer.addHotSpot(targetHotspot);
              console.log("Hotspot updated with text attribute:", newText.trim() || "removed");
              updateConfigInfoBox();
            }
          } else {
            // Edit scene title attribute
            let config = viewer.getConfig();
            let currentSceneId = viewer.getScene();
            let currentScene = config.scenes[currentSceneId];
            let currentTitle = currentScene.title || "";
            let newTitle = prompt("Add title attribute to current scene:", currentTitle);
            if (newTitle !== null) {
              if (newTitle.trim() !== "") {
                currentScene.title = newTitle.trim();
              } else {
                // Remove title attribute if empty
                delete currentScene.title;
              }
              
              console.log("Scene updated with title attribute:", newTitle.trim() || "removed");
              updateConfigInfoBox();
            }
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
        if (event.key === 'u' || event.key === 'U') {
          isUKeyDown = false;
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

          // Always set editorMode to false in export
          clonedConfig.default.editorMode = false;

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
          
          // Update targetPitch and targetYaw for scene hotspots if they exist
          if (updatedHotspot.type === "scene" && updatedHotspot.sceneId) {
            const targetValues = calculateTargetValues(updatedHotspot, currentScene, viewer.getConfig());
            if (targetValues) {
              updatedHotspot.targetPitch = targetValues.targetPitch;
              updatedHotspot.targetYaw = targetValues.targetYaw;
            }
            
            // Update text attribute to show new position with target values
            let textContent = "" + updatedHotspot.id + " → " + updatedHotspot.sceneId;
            if (updatedHotspot.targetPitch !== undefined && updatedHotspot.targetYaw !== undefined) {
              textContent += ` (targetPitch: ${updatedHotspot.targetPitch}, targetYaw: ${updatedHotspot.targetYaw})`;
            }
            updatedHotspot.text = textContent;
          }
          
          // Add the updated hotspot back
          viewer.addHotSpot(updatedHotspot);
          
          draggedHotspot = null;
        }
        // Only add/remove the hotspot if the "H", "I", or "U" key is held down
        else if (isHKeyDown || isIKeyDown || isUKeyDown) {
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
            // Check if it's a scene hotspot and ask about back-connection
            if (closestHotspot.type === "scene" && closestHotspot.sceneId) {
              const removeBackConnection = confirm(
                `Remove hotspot to scene "${closestHotspot.sceneId}".\n\n` +
                `Do you also want to remove the corresponding back-connection from scene "${closestHotspot.sceneId}"?\n\n` +
                `OK = Remove both\nCancel = Remove only this hotspot`
              );
              
                             if (removeBackConnection) {
                 removeBackConnection(closestHotspot.sceneId, currentScene);
               }
            }
            
            // Remove the closest hotspot by its id
            result = viewer.removeHotSpot(closestHotspot.id);
            if (result) {
              console.log(`Removed hotspot with ID: ${closestHotspot.id}`);
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
                // If user cancels or enters empty text, reset I key state and return
                isIKeyDown = false;
                updateConfigInfoBox();
                isProcessingMouseUp = false;
                return;
              }
            } else if (isHKeyDown) {
              // Prompt user for scene ID for scene hotspots
              let sceneId = prompt("Ange scene ID att ansluta till:");
              if (sceneId !== null && sceneId.trim() !== "") {
                sceneId = sceneId.trim();
                
                // Check if target scene exists
                const config = viewer.getConfig();
                if (!config.scenes[sceneId]) {
                  alert(`Scene "${sceneId}" does not exist!`);
                  isHKeyDown = false;
                  updateConfigInfoBox();
                  isProcessingMouseUp = false;
                  return;
                }

                // Check if connection already exists
                const existingConnections = currentHotspots.filter(hs => 
                  hs.type === "scene" && hs.sceneId === sceneId
                );
                
                if (existingConnections.length > 0) {
                  const addAnother = confirm(
                    `There are already ${existingConnections.length} hotspot(s) to scene "${sceneId}".\n\n` +
                    `Do you want to add another hotspot to this scene?\n\n` +
                    `OK = Add hotspot\nCancel = Cancel`
                  );
                  
                  if (!addAnother) {
                    isHKeyDown = false;
                    updateConfigInfoBox();
                    isProcessingMouseUp = false;
                    return;
                  }
                }

                hotspotConfig.sceneId = sceneId;
                
                // Calculate and set targetPitch and targetYaw
                const targetValues = calculateTargetValues(hotspotConfig, currentScene, config);
                if (targetValues) {
                  hotspotConfig.targetPitch = targetValues.targetPitch;
                  hotspotConfig.targetYaw = targetValues.targetYaw;
                  hotspotConfig.text = "" + newId + " → " + sceneId + ` (targetPitch: ${targetValues.targetPitch}, targetYaw: ${targetValues.targetYaw})`;
                } else {
                  hotspotConfig.text = "" + newId + " → " + sceneId;
                }
                
                // Ask user if they want to create a back-connection
                const shouldCreateBackConnection = confirm(
                  `Do you want to create a "back"-hotspot from scene "${sceneId}" to this scene?\n\n` +
                  `OK = Create back-hotspot\nCancel = Create only this hotspot`
                );
                
                if (shouldCreateBackConnection) {
                  // Create back-connection in target scene
                  createBackConnection(sceneId, currentScene);
                }
                
                // Reset H key state after successful creation
                isHKeyDown = false;
              } else {
                // If user cancels or enters empty scene ID, reset H key state and return
                isHKeyDown = false;
                updateConfigInfoBox();
                isProcessingMouseUp = false;
                return;
              }
            } else if (isUKeyDown) {
              // Prompt user for URL for URL hotspots
              let url = prompt("Enter URL for hotspot:");
              if (url !== null && url.trim() !== "") {
                url = url.trim();
                
                // Ensure URL has protocol
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                  url = 'https://' + url;
                }
                
                // Ask user if link should open in same window
                const openInSameWindow = confirm(
                  `Should the link open in the same window?\n\n` +
                  `OK = Open in same window\nCancel = Open in new window`
                );
                
                hotspotConfig.type = "scene";
                hotspotConfig.URL = url;
                delete hotspotConfig.sceneId;
                
                // Set target attribute based on user choice
                if (openInSameWindow) {
                  hotspotConfig.attributes = {
                    target: "_self"
                  };
                  hotspotConfig.text = "" + newId + " → " + url + " (same window)";
                } else {
                  hotspotConfig.text = "" + newId + " → " + url + " (new window)";
                }
                
                // Reset U key state after successful creation
                isUKeyDown = false;
              } else {
                // If user cancels or enters empty URL, reset U key state and return
                isUKeyDown = false;
                updateConfigInfoBox();
                isProcessingMouseUp = false;
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

      function createSceneHotspot(targetSceneId) {
        // Check if target scene exists
        const config = viewer.getConfig();
        if (!config.scenes[targetSceneId]) {
          alert(`Scene "${targetSceneId}" does not exist!`);
          return;
        }

        // Check if connection already exists
        const currentHotspots = config.hotSpots;
        const existingConnection = currentHotspots.find(hs => 
          hs.type === "scene" && hs.sceneId === targetSceneId
        );
        
        if (existingConnection) {
          alert(`Connection to scene "${targetSceneId}" already exists!`);
          return;
        }

        // Get current position
        const currentPitch = parseFloat(viewer.getPitch().toFixed(2));
        const currentYaw = parseFloat(viewer.getYaw().toFixed(2));
        
        // Find next available ID
        const existingIds = currentHotspots.map(hs => hs.id);
        const newId = findNextAvailableId(existingIds);

        // Create new scene hotspot
        const newHotspot = {
          pitch: currentPitch,
          yaw: currentYaw,
          type: "scene",
          sceneId: targetSceneId,
          id: newId
        };

        // Add hotspot to current scene
        viewer.addHotSpot(newHotspot);
        console.log(`Created scene hotspot to "${targetSceneId}" at position (${currentPitch}, ${currentYaw})`);

        // Create back-connection in target scene
        createBackConnection(targetSceneId, currentScene);

        // Update config display
        updateConfigInfoBox();
      }

      function createBackConnection(targetSceneId, sourceSceneId) {
        const config = viewer.getConfig();
        const targetScene = config.scenes[targetSceneId];
        
        if (!targetScene.hotSpots) {
          targetScene.hotSpots = [];
        }

        // Check if back-connection already exists
        const existingBackConnection = targetScene.hotSpots.find(hs => 
          hs.type === "scene" && hs.sceneId === sourceSceneId
        );
        
        if (existingBackConnection) {
          console.log(`Back-connection from "${targetSceneId}" to "${sourceSceneId}" already exists`);
          return;
        }

        // Find next available ID in target scene
        const existingIds = targetScene.hotSpots.map(hs => hs.id);
        const newId = findNextAvailableId(existingIds);

        // Find available yaw position (start at 0, then 15, 30, etc.)
        let yawPosition = 0;
        const existingYaws = targetScene.hotSpots.map(hs => hs.yaw);
        
        while (existingYaws.includes(yawPosition)) {
          yawPosition += 15;
        }

        // Create back-connection hotspot
        const backHotspot = {
          pitch: 0,
          yaw: yawPosition,
          type: "scene",
          sceneId: sourceSceneId,
          id: newId,
          text: "" + newId + " → " + sourceSceneId
        };

        // Add to target scene's hotspots array
        targetScene.hotSpots.push(backHotspot);
        
        console.log(`Created back-connection from "${targetSceneId}" to "${sourceSceneId}" at yaw ${yawPosition}`);
      }

      function removeBackConnection(targetSceneId, sourceSceneId) {
        const config = viewer.getConfig();
        const targetScene = config.scenes[targetSceneId];
        
        if (!targetScene || !targetScene.hotSpots) {
          return;
        }

        // Find and remove the back-connection
        const backConnectionIndex = targetScene.hotSpots.findIndex(hs => 
          hs.type === "scene" && hs.sceneId === sourceSceneId
        );
        
        if (backConnectionIndex !== -1) {
          targetScene.hotSpots.splice(backConnectionIndex, 1);
          console.log(`Removed back-connection from "${targetSceneId}" to "${sourceSceneId}"`);
        }
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

      if(mapData)
      {
        loadMap(viewer, currentScene, mapData, data.default.editorMode); //sceneID sets what dot to have the :current-class
      }

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