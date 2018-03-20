var NACL_RECORDER = function(){

	var timeStart;
	var streamVideo = null;
	var streamElement;
	var fileName = null;

	var nacl = initNacl('manifest_record.nmf', 'nacl', null);

	// ---------------------------
	function initNacl(nmf, type, elem) {
		function h() {
			container.addEventListener("crash", _msg, true), 
			container.addEventListener("message", _crsh, true)
		}

		function i() {
			container.removeEventListener("message", _crsh, true), 
			container.removeEventListener("crash", _msg, true)
		}

		function _msg() {
			b.error("pnacl module crashed", r.lastError), 
			q.onCrash && q.onCrash(r.lastError)
		}

		function _crsh(a) {
			console.log('_crsh', a);
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

	function captureUseNacl(streams, filename) {

		fileName = filename;
		streamVideo = streams[0];

		var data = {	filename:   "/html5_persistent/"+fileName,
						audioTrack: streamVideo.getAudioTracks()[0],
						videoTrack: streamVideo.getVideoTracks()[0]		};

		if (streams.length == 2) {
			data.camPosition = "bottomRight";
			data.camTrack = streams[1].getVideoTracks()[0];
		}


		console.log('captureUseNacl', data);

		nacl.load(function () {
			nacl.postMessage({
				type: 'start',
				data: data
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

