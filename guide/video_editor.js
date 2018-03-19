if (window == chrome.extension.getBackgroundPage()) {
	
	(function(){
		
		// ======================================================================
		var videoEditor = function(hash) {
			
			var self = this;
		
			var tabId = null;
			var tabTitle = null;
			
			var nacl = initNacl('manifest_editor.nmf', 'nacl');
			
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
			this.startConvert = function(req){
				
				console.log('--start convert--', req);
				
				tabTitle = req.title;
				
				config = { crop: null, trim: null };
				config.inFilename = "/html5_persistent/fvd-video.webm";
				config.outFilename = "/html5_persistent/edited.webm";
				if (req.crop) config.crop = req.crop;
				if ( req.trim )  config.trim = req.trim;
				
				convertUseNacl(config);
			}
			
			function convertUseNacl(cnfg) {
				console.log('convertUseNacl', cnfg);
				nacl.load(function () {
					nacl.postMessage({
						type: 'start',
						data: { config: JSON.stringify(cnfg),
								chromeVersion:  Number((/Chrome\/(\d+)/.exec(window.navigator.userAgent) || [void 0, 0])[1])
							  }	
					});
				});
				nacl.onMessage = function(e) {	
					e = e.data;
					if (e.type == 'start') {
					} 
					else if (e.type == 'cancel') {
					} 
					else if (e.type == "error") {
						console.log("VideoEditorError: ", e.data);
					}	
					else if (e.type == "state") {
						var	b = e.data;
						if (b.state == "done") {
							saveVideo();	
						}	
					}	
					else if (e.type == "stack_trace") {
						//g(e.data);
					}	
					else {
						console.log(e.type, e.data);
					}
					
				}
			}

			// ===========================================	
			this.stopConvert = function( ){
				
				console.log('--stop convert--');
				
			}
			
			function sendAppMessage() {
				
				var extId=chrome.i18n.getMessage('@@extension_id');
				
				chrome.tabs.query({}, function (tabs) {
					
					for (var i=0; i<tabs.length; i++) {
						
						if ( tabs[i].url.indexOf('chrome-extension://'+extId+'/app.html#') != -1) {
							chrome.tabs.sendMessage(tabs[i].id, { action:"crop_success", tabId:tabs[i].id  });	
						}
					}	
				});	
			
			}
			
			function saveVideo() {
				
				sendAppMessage();
				
				var removeChars = /[\\\/:*?"<>|"']/g;
				var file_name = tabTitle.replace(removeChars, "");
				
				var url = 'filesystem:chrome-extension://'+chrome.i18n.getMessage('@@extension_id')+'/persistent/edited.webm';
				chrome.downloads.download({
										url: url,
										filename:  file_name+'.webm',
										saveAs: true 
										},
										function (downloadId) {
											console.log('DOWNLOAD', downloadId );
										}		
									);
			}
			
			function showBadge (t) {
				chrome.browserAction.setBadgeText({ text: t.toString() });
				chrome.browserAction.setBadgeBackgroundColor({ color: '#000'});
			}

		}	
			
		this.videoEditor = new videoEditor();

	}).apply(fvdSingleDownloader);
}
else{
	fvdSingleDownloader.videoEditor = chrome.extension.getBackgroundPage().fvdSingleDownloader.videoEditor;
}
			

