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