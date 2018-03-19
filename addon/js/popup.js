﻿var runtimePort;
var isRecording = false;

window.addEventListener( "load", function(){

    runtimePort = chrome.runtime.connect({
        name: location.href.replace(/\/|:|#|\?|\$|\^|%|\.|`|~|!|\+|@|\[|\||]|\|*. /g, '').split('\n').join('').split('\r').join('')
    });

    runtimePort.onMessage.addListener(function(message) {
        if (!message || !message.messageFromContentScript1234) {
            return;
        }
    });

    chrome.storage.sync.get('isRecording', function(obj) {
        document.getElementById('default-section').style.display = obj.isRecording === 'true' ? 'none' : 'block';
        document.getElementById('stop-section').style.display = obj.isRecording === 'true' ? 'block' : 'none';

        isRecording = obj.isRecording === 'true';

        // auto-stop-recording
        if (isRecording === true) {
            document.getElementById('stop-recording').click();
        }
    });

    document.getElementById('stop-recording').onclick = function() {
        chrome.storage.sync.set({
            isRecording: 'false' // FALSE
        }, function() {
            runtimePort.postMessage({
                messageFromContentScript1234: true,
                stopRecording: true
            });
            window.close();
        });
    };

    document.getElementById('microphone-screen-camera').onclick = function() {
        chrome.storage.sync.set({
            enableTabCaptureAPI: 'false',
            enableMicrophone: 'true', // TRUE
            enableCamera: 'true', // TRUE
            enableScreen: 'true', // TRUE
            isRecording: 'true', // TRUE
            enableSpeakers: 'false'
        }, function() {
            runtimePort.postMessage({
                messageFromContentScript1234: true,
                startRecording: true
            });
            window.close();
        });
    };

}, false );