function showMap() {
	document.getElementById("map-container").style.display = "block";
	document.getElementById("show-map-btn").style.display = "none";
  }
  
  function closeMap() {
	document.getElementById("map-container").style.display = "none";
	document.getElementById("show-map-btn").style.display = "block";
  }

  function makeMap(current, json) {
	fetch(json)
	  .then(response => response.json())
	  .then(data => {
		data.panoramas.forEach(panorama => {
		  const button = document.createElement('a');
		  button.className = 'panorama-button';
		  button.style.top = panorama.position.y + 'px';
		  button.style.left = panorama.position.x + 'px';
		  button.href = panorama.link;
		  if (panorama.id === current) {
			button.classList.add('current');
			button.href = '#';
		  }
		  document.getElementById('map-container').appendChild(button);
		});
	  })
	  .catch(error => console.error('Error loading map data:', error));
  }
  
  function showMap() {
	document.getElementById("map-container").style.display = "block";
	document.getElementById("close-btn").style.display = "block";
	document.getElementById("show-map-btn").style.display = "none";

  }
  
  function closeMap() {
	document.getElementById("map-container").style.display = "none";
	document.getElementById("close-btn").style.display = "none";
	document.getElementById("show-map-btn").style.display = "block";
  }
  