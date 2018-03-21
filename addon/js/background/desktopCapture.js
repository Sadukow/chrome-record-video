function captureDesktop() {
    if (isRecordingVOD) {
        stopVODRecording();
        return;
    }

    if (recorder && recorder.streams) {
        recorder.streams.forEach(function(stream, idx) {
            stream.getTracks().forEach(function(track) {
                track.stop();
            });

            if (idx == 0 && typeof stream.onended === 'function') {
                stream.onended();
            }
        });
        recorder.streams = null;
        return;
    }

    chrome.browserAction.setIcon({
        path: 'images/main-icon.png'
    });

    if (enableTabCaptureAPI) {

        var constraints = {
            audio:            true,
            video:            true,
            videoConstraints: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    maxWidth:          640,
                    maxHeight:         480
                }
            }
        };
        
        chrome.tabCapture.capture(constraints, function(stream){

            initVideoPlayer(stream);
            gotStream(stream);

        });

        return;
    }

    var screenSources = ['screen', 'window', 'audio'];

    if (enableSpeakers === false) {
        screenSources = ['screen', 'window'];
    }

    chrome.desktopCapture.chooseDesktopMedia(screenSources, onAccessApproved);
}

function onAccessApproved(chromeMediaSourceId, opts) {

/*    if (!chromeMediaSourceId || !chromeMediaSourceId.toString().length) {
        setDefaults();
        chrome.runtime.reload();
        return;
    }*/

    var constraints = {
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: chromeMediaSourceId
            },
            optional: []
        }
    };

    if (videoMaxFrameRates && videoMaxFrameRates.toString().length) {
        videoMaxFrameRates = parseInt(videoMaxFrameRates);

        // 30 fps seems max-limit in Chrome?
        if (videoMaxFrameRates ) {
            constraints.video.maxFrameRate = videoMaxFrameRates;
        }
    }

    constraints.video.mandatory.maxWidth = 3840;
    constraints.video.mandatory.maxHeight = 2160;

    constraints.video.mandatory.minWidth = 3840;
    constraints.video.mandatory.minHeight = 2160;

    if (opts.canRequestAudioTrack === true) {
        constraints.audio = {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: chromeMediaSourceId,
                echoCancellation: true
            },
            optional: []
        };
    }

    console.log(constraints);

    navigator.webkitGetUserMedia(constraints, function(stream) {
        initVideoPlayer(stream);
        gotStream(stream);
    }, function() {});
}

