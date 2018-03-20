var NACL_RECORDER = function(){

	var timeStart;
	var streamVideo = null;
	var streamElement;
	var fileName = null;

	var nacl = initNacl('manifest_record.nmf', 'nacl', null);

	// ---------------------------
	function initNacl(nmf, type, elem) {
		function h() {
			container.addEventListener("crash", j, true), 
			container.addEventListener("message", k, true)
		}

		function i() {
			container.removeEventListener("message", k, true), 
			container.removeEventListener("crash", j, true)
		}

		function j() {
			b.error("pnacl module crashed", r.lastError), q.onCrash && q.onCrash(r.lastError)
		}

		function k(a) {
			//console.log(a);
			q.onMessage && q.onMessage(a)
		}

		var l = type || "nacl";
		var m = ["<embed ", "width=0 height=0 ", 'src="' + nmf + '" ', ' type="application/x-' + l + '" />'].join("");
		var n, 
			container = document.createElement("div"), 
			q = {isLoaded: false};
		var r;

		elem || (elem = document.body);
		q.onMessage = void 0;
		q.onCrash = void 0;

		return q.load = function (cb) {
			function b() {
				container.removeEventListener("load", d, true);
				container.removeEventListener("error", f, true)
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
				container.addEventListener("load", d, true),
				container.addEventListener("error", f, true),
				h(),
				container.innerHTML = m,
				r = container.children[0],
				elem.appendChild(container),
				container.focus();
			}
			q.state = "active"					
		}, 
		q.unload = function () {
			q.isLoaded = false, 
			i(), 
			container.innerHTML = "", 
			elem.removeChild(container), 
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

	function captureUseNacl(stream, filename) {

		streamVideo = stream;
		var audio = stream.getAudioTracks()[0];
		var video = stream.getVideoTracks()[0];

		fileName = filename;

		console.log('captureUseNacl', audio, video);

		nacl.load(function () {
			nacl.postMessage({
				type: 'start',
				data: {
					audioTrack: audio,
					videoTrack: video,
					filename:   "/html5_persistent/"+fileName
				}
			});
		});
	}


	
	// =============================================================
	function stop( callback ) {

		console.log('--nacl.stop--');

		state = false;
		stopRecord();

		function stopRecord() {
			console.log('stopRecord');
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
				var extId=chrome.i18n.getMessage('@@extension_id');
				var url = 'filesystem:chrome-extension://'+extId+'/persistent/'+fileName;
				console.log(url);
				callback(url, fileName);
			}, 1000);
		}

	}	

	function stopStream() {
		timeStart = null;

		streamVideo.active && streamVideo.stop();

		streamElement && streamElement.parentNode.removeChild(streamElement);
		streamElement = null;
	}


	return {
		capture: captureUseNacl,
		stop:  stop,
	}	
}

