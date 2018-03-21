var extId, url, title;
var crop_height = 0, 
	crop_left = 0, 
	crop_width = 0, 
	crop_top = 0;

var host = '';
var hash = '';


window.addEventListener( "load", function(){

	host = document.location.host;
	
	hash = document.location.hash;
	hash = hash.substring(1, hash.length);
	var mm = hash.split('/');

console.log(mm)	
	
	url = decodeURIComponent(mm[2]);
	//extId = mm[2];
	//url = 'filesystem:chrome-extension://'+extId+'/persistent/nimbus-video.webm';
	title = decodeURIComponent(mm[3]);

	var videoContainer = document.getElementById("videoContainer");
	videoContainer.setAttribute('src', url);	
	
	var videoTitle = document.getElementById("videoTitle");
	videoTitle.textContent = title;	

	var buttonSave = document.getElementById("buttonSave");
	buttonSave.addEventListener("click", saveAll);
	
	var buttonCrop = document.getElementById("buttonCrop");
	buttonCrop.addEventListener("click", crop);
	
	var buttonCropCancel = document.getElementById("buttonCropCancel");
	buttonCropCancel.addEventListener("click", cropCancel);
	
	var buttonCropSave = document.getElementById("buttonCropSave");
	buttonCropSave.addEventListener("click", cropSave);
	
	var buttonLib = document.getElementById("buttonLib");
	buttonLib.addEventListener("click", cropSaveLib);
	
    chrome.runtime.onMessage.addListener( function(request, sender, sendResponse) {     
	
			console.log(request); 

			if(request.action=="crop_success")  {
	
				var blockCrop = document.getElementById("blockCrop");
				blockCrop.setAttribute('style', 'display: none');

			}
	
	});
	
	
}, false );

function save() {
	saveVideo(url, title);
}	

function errorHandler(e){
	
	console.log(e);
	var msg = '';

	switch (e.code) {
		case FileError.QUOTA_EXCEEDED_ERR:
		  msg = 'QUOTA_EXCEEDED_ERR';
		  break;
		case FileError.NOT_FOUND_ERR:
		  msg = 'NOT_FOUND_ERR';
		  break;
		case FileError.SECURITY_ERR:
		  msg = 'SECURITY_ERR';
		  break;
		case FileError.INVALID_MODIFICATION_ERR:
		  msg = 'INVALID_MODIFICATION_ERR';
		  break;
		case FileError.INVALID_STATE_ERR:
		  msg = 'INVALID_STATE_ERR';
		  break;
		default:
		  msg = 'Unknown Error';
		  break;
	};

	console.log('Error: ' + msg);
}

function saveVideo(url, tabTitle) {
	chrome.downloads.download({
							url: url,
							filename:  tabTitle,
							saveAs: true 
							},
							function (downloadId) {
								console.log('DOWNLOAD', downloadId );
							}		
						);
}

function saveAll(event) {
	
	window.requestFileSystem  = window.requestFileSystem || window.webkitRequestFileSystem;				
	window.requestFileSystem(window.PERSISTENT, 1024*1024, onInitFs, errorHandler);
	
	function onInitFs(fs) {
		
		console.log(fs);

		var dirReader = fs.root.createReader();
		var entries = [];

		// Call the reader.readEntries() until no more results are returned.
		var readEntries = function() {
			dirReader.readEntries (function(results) {
				if (!results.length) {
					listResults(entries.sort());
				} 
				else {
					entries = entries.concat(toArray(results));
					readEntries();
				}
			}, errorHandler);
		};

		readEntries(); // Start reading dirs.

	}	
	
	function toArray(list) {
	  return Array.prototype.slice.call(list || [], 0);
	}

	function listResults(entries) {
		entries.forEach(function(entry, i) {
			console.log(entry);
			downloadResults(entry.name);
		});
	}		

	function downloadResults(name) {
		var removeChars = /[\\\/:*?"<>|"']/g;
		var file_name = name.replace(removeChars, "");
		
		var url = 'filesystem:chrome-extension://'+host+'/persistent/'+name;
		console.log(url);
		
		chrome.downloads.download({
								url: url,
								filename:  file_name,
								saveAs: true 
								},
								function (downloadId) {
									console.log('DOWNLOAD', downloadId );
								}		
							); 
	}
	
	event.stopPropagation();												
}


function crop() {
	
	var cropMouse = false;

	var blockCrop = document.getElementById("blockCrop");
	
	var topElem = blockCrop.querySelector('.top');
	var bottomElem = blockCrop.querySelector('.bottom');
	var leftElem = blockCrop.querySelector('.left');
	var rightElem = blockCrop.querySelector('.right');
	var cropBox = blockCrop.querySelector('.crop-box');
	var dimInfo = blockCrop.querySelector('.dimension-info');

	var actionCrop = document.getElementById("actionCrop");
	actionCrop.setAttribute('style', 'display: none');

	var buttonCropSave = document.getElementById("buttonCropSave");
	buttonCropSave.setAttribute('disabled', true);
	
 	topElem.removeAttribute('style');
	bottomElem.removeAttribute('style');
	leftElem.removeAttribute('style');
	rightElem.removeAttribute('style');
	cropBox.removeAttribute('style'); 
	
	var loadingIndicator = document.getElementById("loadingIndicator");
	loadingIndicator.setAttribute('style', 'display: none');
	
	var box = null;
	crop_height = 0, crop_left = 0, crop_width = 0, crop_top = 0;
	
	blockCrop.setAttribute('style', 'display: block');
	setTimeout( function() {
		box = blockCrop.getBoundingClientRect();		
	}, 10);	
	
	blockCrop.addEventListener("mousedown", on_MouseDown);
	blockCrop.addEventListener("mouseup", on_MouseUp);
	blockCrop.addEventListener("mousemove", on_MouseMove);
	
	
	//-----------------------------------------------
	function on_MouseUp(event) {
		
		cropMouse = false;
		
		blockCrop.removeEventListener("mousedown", on_MouseDown);
		blockCrop.removeEventListener("mouseup", on_MouseUp);
		blockCrop.removeEventListener("mousemove", on_MouseMove);
		
		actionCrop.setAttribute('style', 'display: block');
		
		var buttonCropSave = document.getElementById("buttonCropSave");
		buttonCropSave.removeAttribute('disabled');
		
	
		event.stopPropagation();												
	}
	
	//-----------------------------------------------
	function on_MouseDown(event) {
		
		cropMouse = true;
		
		var mX = event.pageX;
		var mY = event.pageY;
		
		crop_top = mY - box.top;
		crop_left = mX - box.left; 
		crop_height = 10;
		crop_width = 10;
		
		set();
		
		event.stopPropagation();												
	}
	
	//-----------------------------------------------
	function on_MouseMove(event) {
		
		if (cropMouse) {
			
			var mX = event.pageX;
			var mY = event.pageY;
			
			crop_height = mY - box.top - crop_top;
			crop_width = mX - box.left - crop_left; 
			
			set();	
			
			if (crop_height> 50 && crop_width>100) {
				dimInfo.textContent = crop_width+'X'+crop_height+'px';	
			}	
			else {
				dimInfo.textContent = '';
			}	

		}	

	}
	
	//-----------------------------------------------
	function set() {

		topElem.setAttribute('style', 'height: '+crop_top+'px;');
		bottomElem.setAttribute('style', 'top: '+(crop_top+crop_height)+'px;');
		leftElem.setAttribute('style', 'top: '+crop_top+'px; width: '+crop_left+'px; height: '+crop_height+'px;');
		rightElem.setAttribute('style', 'top: '+crop_top+'px; left: '+(crop_left+crop_width)+'px; height: '+crop_height+'px;');
		cropBox.setAttribute('style', 'top: '+crop_top+'px; left: '+crop_left+'px; width: '+crop_width+'px; height: '+crop_height+'px;');

	}	
	
}	

function cropCancel() {

	var blockCrop = document.getElementById("blockCrop");
	blockCrop.setAttribute('style', 'display: none');

}

function cropSaveLib() {
	crop_width = 800, crop_height=450, crop_left=340, crop_top=50;
	cropSave();
}

function cropSave() {

	//var blockCrop = document.getElementById("blockCrop");
	//blockCrop.setAttribute('style', 'display: none');

	var loadingIndicator = document.getElementById("loadingIndicator");
	loadingIndicator.setAttribute('style', 'display: block');
	
	//console.log(crop_height, crop_left, crop_width, crop_top);  457:344:815:53  //800:450:340:50
	
	chrome.extension.sendMessage({akce:"FFMPEG_work",  
								  url: url,  
								  title: title,
								  args: '-i input.webm -vf showinfo -strict -2 -c:v libx264 -vf crop='+crop_width+':'+crop_height+':'+crop_left+':'+crop_top+' -c:a copy  output.mp4',
								  //args: '-i input.webm -vf crop='+crop_width+':'+crop_height+':'+crop_left+':'+crop_top+' output.mpeg',
							     },	
								 function( response ){ 	
									console.log('==SUCCESS==');
								 });

}
