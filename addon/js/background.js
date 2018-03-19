
chrome.storage.sync.set({
    isRecording: 'false' // FALSE
});

chrome.browserAction.setIcon({
    path: 'images/main-icon.png'
});

var runtimePort;

chrome.runtime.onConnect.addListener(function(port) {
    runtimePort = port;

    runtimePort.onMessage.addListener(function(message) {

        console.log(message);

        if (!message || !message.messageFromContentScript1234) {
            return;
        }

        if (message.startRecording) {
            if (!!isRecordingVOD) {
                stopVODRecording();
                return;
            }

            getUserConfigs();
            return;
        }

        if (message.stopRecording) {

            console.log(recorder);

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
            }

            isRecording = false;
            setBadgeText('');
            chrome.browserAction.setIcon({
                path: 'images/main-icon.png'
            });
            return;
        }
    });
});

// ------------------------------------------------------
function gotStream(stream) {

    console.log(stream);

    var options = {
        type: 'video',
        disableLogs: false,
    };

    if (!videoCodec) {
        videoCodec = 'Default'; // prefer VP9 by default
    }

    if (videoCodec) {
        if (videoCodec === 'Default') {
            options.mimeType = 'video/webm\;codecs=vp9';
        }

        if (videoCodec === 'VP8') {
            options.mimeType = 'video/webm\;codecs=vp8';
        }

        if (videoCodec === 'VP9') {
            options.mimeType = 'video/webm\;codecs=vp9';
        }

        if (videoCodec === 'H264') {
            if (isMimeTypeSupported('video/webm\;codecs=h264')) {
                options.mimeType = 'video/webm\;codecs=h264';
            }
        }

        if (videoCodec === 'MKV') {
            if (isMimeTypeSupported('video/x-matroska;codecs=avc1')) {
                options.mimeType = 'video/x-matroska;codecs=avc1';
            }
        }
    }

    if (bitsPerSecond) {
        bitsPerSecond = parseInt(bitsPerSecond);
        if (!bitsPerSecond || bitsPerSecond < 100) {
            bitsPerSecond = 8000000000; // 1 GB /second
        }
    }

    if (bitsPerSecond) {
        options.bitsPerSecond = bitsPerSecond;
    }

    if (cameraStream && cameraStream.getAudioTracks().length) {
        cameraStream.getAudioTracks().forEach(function(track) {
            cameraStream.removeTrack(track);
            stream.addTrack(track);
        });
    }

    // fix https://github.com/muaz-khan/RecordRTC/issues/281
    options.ignoreMutedMedia = false;

    console.log('====RecordRTC====');

    if (cameraStream && cameraStream.getVideoTracks().length) {

        // adjust video on top over screen

        // on faster systems (i.e. 4MB or higher RAM):
        // screen: 3840x2160 
        // camera: 1280x720
        stream.width = screen.width;
        stream.height = screen.height;
        stream.fullcanvas = true; // screen should be full-width (wider/full-screen)

        // camera positioning + width/height
        cameraStream.width = parseInt((20 / 100) * stream.width);
        cameraStream.height = parseInt((20 / 100) * stream.height);
        cameraStream.top = stream.height - cameraStream.height;
        cameraStream.left = stream.width - cameraStream.width;

        // frame-rates
        options.frameInterval = 1;

        recorder = new MRecordRTC(stream);
        //recorder.addStream(stream);
        //recorder.addStream(cameraStream);


        recorder.startRecording();

        recorder.streams = [stream, cameraStream];
    } else {
        recorder = RecordRTC(stream, options);
        recorder.startRecording();

        recorder.streams = [stream];
    }

    //recorder.record();

    isRecording = true;
    onRecording();

    recorder.streams[0].onended = function() {
        if (recorder && recorder.streams.length) {
            recorder.streams[0].onended = null;
        }

        stopScreenRecording();
    };

    if (recorder.streams[0].getVideoTracks().length) {
        recorder.streams[0].getVideoTracks().forEach(function(track) {
            track.onended = function() {
                if (!recorder) return;
                var stream = recorder.streams[0];
                if (!stream || typeof stream.onended !== 'function') return;

                stream.onended();
            };
        });
    }

    initialTime = Date.now()
    timer = setInterval(checkTime, 100);
}


// --------------------------------------------------------------
function stopScreenRecording() {

    console.log('stopScreenRecording');

    isRecording = false;

    recorder.stopRecording(function (url, type) {

        var mimeType = 'video/webm';
        var fileExtension = 'webm';

        if (videoCodec === 'H264') {
            if (isMimeTypeSupported('video/webm\;codecs=h264')) {
                mimeType = 'video/mp4';
                fileExtension = 'mp4';
            }
        }

        if (videoCodec === 'MKV') {
            if (isMimeTypeSupported('video/x-matroska;codecs=avc1')) {
                mimeType = 'video/mkv';
                fileExtension = 'mkv';
            }
        }

        var file = new File([recorder ? recorder.blob : ''], getFileName(fileExtension), {
            type: mimeType
        });

        chrome.tabs.create({url: "app.html#/files/"+encodeURIComponent(url)+'/'+encodeURIComponent(file.name)}, function (tab) {     }); 

        // invokeSaveAsDialog(file, file.name);

        setTimeout(function() {
            setDefaults();
            // chrome.runtime.reload();            
        }, 1000);

        try {
            videoPlayers.forEach(function(player) {
                player.src = null;
            });
            videoPlayers = [];
        } catch (e) {}

        // for dropdown.js
        chrome.storage.sync.set({
            isRecording: 'false' // FALSE
        });

        
    });

    if (timer) {
        clearTimeout(timer);
    }
    setBadgeText('');

    chrome.browserAction.setTitle({
        title: 'Record Your Screen, Tab or Camera'
    });
}

function setDefaults() {
    chrome.browserAction.setIcon({
        path: 'images/main-icon.png'
    });

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
    }

    recorder = null;
    isRecording = false;
    imgIndex = 0;

    bitsPerSecond = 0;
    enableTabCaptureAPI = false;
    enableScreen = true;
    enableMicrophone = false;
    enableCamera = false;
    cameraStream = false;
    enableSpeakers = true;
    videoCodec = 'Default';
    videoMaxFrameRates = '';
    isRecordingVOD = false;
    startedVODRecordedAt = (new Date).getTime();

    // for dropdown.js
    chrome.storage.sync.set({
        isRecording: 'false' // FALSE
    });
}

// --------------------------------------------------------------
function getUserConfigs() {

    chrome.storage.sync.get(null, function(items) {

        console.log(items);

        if (items['bitsPerSecond'] && items['bitsPerSecond'].toString().length && items['bitsPerSecond'] !== 'default') {
            bitsPerSecond = parseInt(items['bitsPerSecond']);
        }

        if (items['enableTabCaptureAPI']) {
            enableTabCaptureAPI = items['enableTabCaptureAPI'] == 'true';
        }

        if (items['enableCamera']) {
            enableCamera = items['enableCamera'] == 'true';
        }

        if (items['enableSpeakers']) {
            enableSpeakers = items['enableSpeakers'] == 'true';
        }

        if (items['enableScreen']) {
            enableScreen = items['enableScreen'] == 'true';
        }

        if (items['enableMicrophone']) {
            enableMicrophone = items['enableMicrophone'] == 'true';
        }

        if (items['videoCodec']) {
            videoCodec = items['videoCodec'];
        }

        if (items['videoMaxFrameRates'] && items['videoMaxFrameRates'].toString().length) {
            videoMaxFrameRates = parseInt(items['videoMaxFrameRates']);
        }

        if (items['microphone']) {
            microphoneDevice = items['microphone'];
        }

        if (items['camera']) {
            cameraDevice = items['camera'];
        }

        if (items['metodRecord']) {
            metodRecord = items['metodRecord'];
        }

        if (enableMicrophone || enableCamera) {
            captureCamera(function(stream) {
                cameraStream = stream;
                captureDesktop();
            });
            return;
        }

        captureDesktop();
    });
}

function stopVODRecording() {
    isRecordingVOD = false;
}

// ----------------------------------------------
var videoPlayers = [];

function initVideoPlayer(stream) {

    var videoPlayer = document.createElement('video');
    videoPlayer.muted = !enableTabCaptureAPI;
    videoPlayer.volume = !!enableTabCaptureAPI;
    videoPlayer.src = URL.createObjectURL(stream);

    videoPlayer.play();

    videoPlayers.push(videoPlayer);
}
