if (window == chrome.extension.getBackgroundPage()) {
	
	(function(){
		
		// ======================================================================
		var videoRecorder = function(hash) {
			
			var self = this;
		
			var tabId = null;
			var tabTitle = null;
			
			var activeTab = null;
			var streamVideo = {};
			var timeStart;
			var streamElement;
			var interval = null;
			
			var nacl = initNacl('manifest_record.nmf', 'nacl');
			
/* 			window.requestFileSystem  = window.requestFileSystem || window.webkitRequestFileSystem;				
			var requestedBytes = 1024*1024*1024; 
			navigator.webkitTemporaryStorage.requestQuota(requestedBytes, function(grantedBytes) {
				_grantedBytes = grantedBytes;
				window.webkitRequestFileSystem(window.PERSISTENT, grantedBytes, onInitFs, self.errorHandler);
			}, self.errorHandler);		 
			
/* 			webkitRequestFileSystem(window.PERSISTENT, 2 * 1024 * 1024 * 1024, function(fs){
				fs.root.getFile('fvd-video.webm', {create: true}, function(file) {
					console.log('==FINISH==', file.toURL());
				});
			});
 */			

			// -------------------------------------------------------------------
			function onInitFs(fs) {
				//console.log('Opened file system: ' + fs.name);
			}	
			
			// -------------------------------------------------------------------
			this.errorHandler = function(e){
				
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
			
			// -------------------------------------------------------------------
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
			
			
			// ---------------------------
			function initNacl(d, f) {
				function h() {
					p.addEventListener("crash", j, true), p.addEventListener("message", k, true)
				}

				function i() {
					p.removeEventListener("message", k, true), p.removeEventListener("crash", j, true)
				}

				function j() {
					b.error("pnacl module crashed", r.lastError), q.onCrash && q.onCrash(r.lastError)
				}

				function k(a) {
					//console.log(a);
					q.onMessage && q.onMessage(a)
				}

				var l = f || "nacl";
				var m = ["<embed ", "width=0 height=0 ", 'src="' + d + '" ', ' type="application/x-' + l + '" />'].join("");
				var n, 
					p = document.createElement("div"), 
					q = {isLoaded: false};
				var r;

				q.onMessage = void 0;
				q.onCrash = void 0;

				return q.load = function (cb) {
					function b() {
						p.removeEventListener("load", d, true);
						p.removeEventListener("error", f, true)
					}

					function d() {
						b();
						console.log('resolved');
						cb && cb();
					}

					function f() {
						b();
						console.log(r.lastError);
					}

					if (!n) {
						p.addEventListener("load", d, true),
							p.addEventListener("error", f, true),
							h(),
							p.innerHTML = m,
							r = p.children[0],
							document.body.appendChild(p),
							p.focus();
					}
					q.state = "active"					
				}, 
				q.unload = function () {
					q.isLoaded = false, 
					i(), 
					p.innerHTML = "", 
					document.body.removeChild(p), 
					r = null, 
					n = null,
					q.state = "inactive"					
				}, 
				q.getElement = function () {
					return r;
				}, 
				q.postMessage = function (a) {
					if (!r) throw new Error("not loaded");
					console.log(a);
					r.postMessage(a)
				}, 
				q  
			}
			
			// ===========================================================	
			this.startRecord = function( ){
				
				console.log('--start--');
				
				if ( !_b(fvdSingleDownloader.Prefs.get( "fvd.recorder_video" )) )  return;
				
				
				chrome.tabs.query({active: true, lastFocusedWindow: true}, function (tabs) {
					activeTab = tabs[0];
					var constraints = {
						audio:            _b(fvdSingleDownloader.Prefs.get( "fvd.recorder_audio" )),
						video:            true,
						videoConstraints: {
							mandatory: {
								chromeMediaSource: 'tab',
								maxWidth:          activeTab.width,
								maxHeight:         activeTab.height
							}
						}
					};
					
					chrome.tabCapture.capture(constraints, recordStream);
					
				});
				
			}
			
			function recordStream(stream) {
				
				console.log('recordStream', stream);
				
				streamVideo = stream;
				var audio = stream.getAudioTracks()[0];
				var video = stream.getVideoTracks()[0];

				captureUseNacl(audio, video);

				(function () {
					var v = document.createElement('video');
					document.body.appendChild(v);
					v.setAttribute('autoplay', '');
					v.addEventListener('canplay', function () {
						console.log('play video');
					}, false);
					v.src = window.URL.createObjectURL(stream);
					streamElement = v;
				})()
				
				timeStart = Date.now();

				setTimeout(function () {
					fvdSingleDownloader.MainButton.refreshMainButtonStatus();
					
					interval = setInterval(function (){  showTime();   }, 500);
					
				}, 500);
				
			}
			
			function captureUseNacl(audio, video) {
				console.log('captureUseNacl', audio, video);
				nacl.load(function () {
					nacl.postMessage({
						type: 'start',
						data: {
							audioTrack: audio,
							videoTrack: video,
							filename:   "/html5_persistent/fvd-video.webm"
						}
					});
				});
			}

			// ===========================================	
			this.stopRecord = function( ){
				
				console.log('--stop--');

				var title = activeTab.title;
				var t = 0;
				
				stopRecord();

				function stopRecord() {
					t = getTimeRecord();					
					
					console.log('stopRecord', streamVideo, t);
					stopNacl();
					setTimeout(function () {
						stopStream();
					}, 1000);
					activeTab = null;
				}
					
				function stopNacl() {
					nacl.postMessage({
						type: 'stop',
						data: {}
					});
					setTimeout(function () {
						nacl.unload();
						openVideo(title, t);
					}, 1000);
				}
				
				function stopStream() {
					
					timeStart = null;

					streamVideo.active && streamVideo.stop();

					streamElement && streamElement.parentNode.removeChild(streamElement);
					streamElement = null;
					
					clearInterval(interval);
					setTimeout(function () {
						showBadge('');
						fvdSingleDownloader.MainButton.refreshMainButtonStatus();
					}, 500);
				}
				
			}
			
			function showTime() {
				var t = new Date(getTimeRecord());
				var text = ('0' + t.getUTCMinutes()).slice(-2) + ':' + ('0' + t.getUTCSeconds()).slice(-2);
				showBadge (text)
			}

			this.getStatus = function( ){
				return !!streamVideo.active;
			}
			
			function getTimeRecord() {
				return timeStart ? (Date.now() - timeStart) : 0;
			}
			
			function saveVideo(url, tabTitle) {
				chrome.downloads.download({
										url: url,
										filename:  tabTitle+'.webm',
										saveAs: true 
										},
										function (downloadId) {
											console.log('DOWNLOAD', downloadId );
										}		
									);
			}
			function openVideo(tabTitle, time) {
  				chrome.tabs.create({url: "app.html#"+encodeURIComponent(tabTitle)+'/'+time}, function (tab) {
					
				});	  
			}
			
			function showBadge (t) {
				chrome.browserAction.setBadgeText({ text: t.toString() });
				chrome.browserAction.setBadgeBackgroundColor({ color: '#000'});
			}

		}	
			
		this.videoRecorder = new videoRecorder();

		var MediaStream = window.MediaStream;

		if (typeof MediaStream === 'undefined' && typeof webkitMediaStream !== 'undefined') {
			MediaStream = webkitMediaStream;
		}
		if (typeof MediaStream !== 'undefined' && !('stop' in MediaStream.prototype)) {
			MediaStream.prototype.stop = function () {
				this.getAudioTracks().forEach(function (track) {
					track.stop();
				});
				this.getVideoTracks().forEach(function (track) {
					track.stop();
				});
			};
		}
		
	}).apply(fvdSingleDownloader);
}
else{
	fvdSingleDownloader.videoRecorder = chrome.extension.getBackgroundPage().fvdSingleDownloader.videoRecorder;
}
			

