// Global objects
var speechRecognizer;
var avatarSynthesizer;
var peerConnection;
var messages = [];
var messageInitiated = false;
var dataSources = [];
var sentenceLevelPunctuations = ['.', '?', '!', ':', ';', '。', '？', '！', '：', '；'];
var enableDisplayTextAlignmentWithSpeech = true;
var enableQuickReply = false;
var quickReplies = ['Let me take a look.', 'Let me check.', 'One moment, please.'];
var byodDocRegex = new RegExp(/\[doc(\d+)\]/g);
var isSpeaking = false;
var speakingText = "";
var spokenTextQueue = [];
var sessionActive = false;
var lastSpeakTime;
var imgUrl = "";

// =================== CONNECT AVATAR SERVICE ===================
function connectAvatar() {
    const cogSvcRegion = document.getElementById('region').value.trim();
    const cogSvcSubKey = document.getElementById('APIKey').value.trim();
    if (!cogSvcSubKey) {
        alert('Please fill in the API key of your speech resource.');
        return;
    }

    const privateEndpointEnabled = document.getElementById('enablePrivateEndpoint').checked;
    let privateEndpoint = '';
    if (privateEndpointEnabled) {
        const privateEndpointInput = document.getElementById('privateEndpoint').value.trim();
        if (!privateEndpointInput.startsWith('https://')) {
            alert('Please fill in a valid Azure Speech endpoint (https://...).');
            return;
        }
        privateEndpoint = privateEndpointInput.slice(8);
    }

    let speechSynthesisConfig;
    if (privateEndpointEnabled) {
        speechSynthesisConfig = SpeechSDK.SpeechConfig.fromEndpoint(
            new URL(`wss://${privateEndpoint}/tts/cognitiveservices/websocket/v1?enableTalkingAvatar=true`),
            cogSvcSubKey
        );
    } else {
        speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
    }
    // Removed custom voice endpoint ID line
    // speechSynthesisConfig.endpointId = document.getElementById('customVoiceEndpointId').value.trim();

    // Avatar config
    const talkingAvatarCharacter = document.getElementById('talkingAvatarCharacter').value.trim();
    const talkingAvatarStyle = document.getElementById('talkingAvatarStyle').value.trim();
    const avatarConfig = new SpeechSDK.AvatarConfig(talkingAvatarCharacter, talkingAvatarStyle);
    // Removed: avatarConfig.customized reference

    avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig);
    avatarSynthesizer.avatarEventReceived = (s, e) => {
        let offsetMsg = (e.offset === 0) ? '' : `, offset from session start: ${e.offset / 10000}ms.`;
        console.log('Avatar event: ' + e.description + offsetMsg);
    };

    // Prepare STT config
    const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromEndpoint(
        new URL(`wss://${cogSvcRegion}.stt.speech.microsoft.com/speech/universal/v2`),
        cogSvcSubKey
    );
    speechRecognitionConfig.setProperty(
        SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode,
        "Continuous"
    );
    const sttLocales = document.getElementById('sttLocales').value.split(',');
    const autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(sttLocales);
    speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(
        speechRecognitionConfig,
        autoDetectSourceLanguageConfig,
        SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    );

    // Check Azure OpenAI
    const azureOpenAIEndpoint = document.getElementById('azureOpenAIEndpoint').value.trim();
    const azureOpenAIApiKey = document.getElementById('azureOpenAIApiKey').value.trim();
    const azureOpenAIDeploymentName = document.getElementById('azureOpenAIDeploymentName').value.trim();
    if (!azureOpenAIEndpoint || !azureOpenAIApiKey || !azureOpenAIDeploymentName) {
        alert('Please fill in the Azure OpenAI endpoint, API key, and deployment name.');
        return;
    }

    // Possibly enable "On Your Data"
    dataSources = [];
    if (document.getElementById('enableOyd').checked) {
        const azureCogSearchEndpoint = document.getElementById('azureCogSearchEndpoint').value.trim();
        const azureCogSearchApiKey = document.getElementById('azureCogSearchApiKey').value.trim();
        const azureCogSearchIndexName = document.getElementById('azureCogSearchIndexName').value.trim();
        if (!azureCogSearchEndpoint || !azureCogSearchApiKey || !azureCogSearchIndexName) {
            alert('Please fill in the Azure Cognitive Search endpoint, API key, and index name.');
            return;
        }
        setDataSources(azureCogSearchEndpoint, azureCogSearchApiKey, azureCogSearchIndexName);
    }

    if (!messageInitiated) {
        initMessages();
        messageInitiated = true;
    }

    // Disable open session button & hide configuration
    document.getElementById('openSessionButton').disabled = true;
    document.getElementById('configuration').hidden = true;

    // Get token from TTS service
    const xhr = new XMLHttpRequest();
    if (privateEndpointEnabled) {
        xhr.open("GET", `https://${privateEndpoint}/tts/cognitiveservices/avatar/relay/token/v1`);
    } else {
        xhr.open("GET", `https://${cogSvcRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`);
    }
    xhr.setRequestHeader("Ocp-Apim-Subscription-Key", cogSvcSubKey);
    xhr.addEventListener("readystatechange", function() {
        if (this.readyState === 4) {
            const responseData = JSON.parse(this.responseText);
            const iceServerUrl = responseData.Urls[0];
            const iceServerUsername = responseData.Username;
            const iceServerCredential = responseData.Password;
            setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential);
        }
    });
    xhr.send();
}

// =================== SETUP WEBSOCKET & AVATAR ===================
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
    peerConnection = new RTCPeerConnection({
        iceServers: [{
            urls: [iceServerUrl],
            username: iceServerUsername,
            credential: iceServerCredential
        }]
    });

    peerConnection.ontrack = (event) => {
        if (event.track.kind === 'audio') {
            let audioElement = document.createElement('audio');
            audioElement.id = 'audioPlayer';
            audioElement.srcObject = event.streams[0];
            audioElement.autoplay = true;
            audioElement.onplaying = () => console.log('WebRTC audio connected.');

            const remoteDiv = document.getElementById('remoteVideo');
            [...remoteDiv.childNodes].forEach(node => {
                if (node.localName === 'audio') remoteDiv.removeChild(node);
            });
            remoteDiv.appendChild(audioElement);
        } else if (event.track.kind === 'video') {
            let videoElement = document.createElement('video');
            videoElement.id = 'videoPlayer';
            videoElement.srcObject = event.streams[0];
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            videoElement.onplaying = () => {
                console.log('WebRTC video connected.');
                const remoteDiv = document.getElementById('remoteVideo');
                [...remoteDiv.childNodes].forEach(node => {
                    if (node.localName === 'video') remoteDiv.removeChild(node);
                });
                remoteDiv.appendChild(videoElement);

                document.getElementById('microphone').disabled = false;
                document.getElementById('stopSession').disabled = false;
                document.getElementById('chatHistory').hidden = false;

                // Mark session active after 5 seconds
                setTimeout(() => { sessionActive = true; }, 5000);
            };
        }
    };

    peerConnection.addEventListener("datachannel", event => {
        const dataChannel = event.channel;
        dataChannel.onmessage = e => {
            const webRTCEvent = JSON.parse(e.data);
            const subtitles = document.getElementById('subtitles');
            // Since "showSubtitles" checkbox is removed, you can always hide subtitles
            subtitles.hidden = true;
            console.log('[WebRTC event] ' + e.data);
        };
    });
    peerConnection.createDataChannel("eventChannel");

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE state: " + peerConnection.iceConnectionState);
    };

    peerConnection.addTransceiver('video', { direction: 'sendrecv' });
    peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

    avatarSynthesizer.startAvatarAsync(peerConnection)
    .then(r => {
        if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log('Avatar started, resultId:' + r.resultId);
        } else {
            console.log('Unable to start avatar, resultId:' + r.resultId);
            if (r.reason === SpeechSDK.ResultReason.Canceled) {
                const cancellationDetails = SpeechSDK.CancellationDetails.fromResult(r);
                console.log('Avatar canceled: ' + cancellationDetails.errorDetails);
            }
            document.getElementById('openSessionButton').disabled = false;
            document.getElementById('configuration').hidden = false;
        }
    })
    .catch(error => {
        console.log('Avatar failed to start: ' + error);
        document.getElementById('openSessionButton').disabled = false;
        document.getElementById('configuration').hidden = false;
    });
}

// =================== DISCONNECT AVATAR ===================
function disconnectAvatar() {
    if (avatarSynthesizer) avatarSynthesizer.close();
    if (speechRecognizer) {
        speechRecognizer.stopContinuousRecognitionAsync();
        speechRecognizer.close();
    }
    sessionActive = false;
}

// =================== INITIALIZE MESSAGES ===================
function initMessages() {
    messages = [];
    if (dataSources.length === 0) {
        const systemPrompt = document.getElementById('prompt').value;
        messages.push({ role: 'system', content: systemPrompt });
    }
}

// =================== SET DATA SOURCES ===================
function setDataSources(azureCogSearchEndpoint, azureCogSearchApiKey, azureCogSearchIndexName) {
    dataSources.push({
        type: 'AzureCognitiveSearch',
        parameters: {
            endpoint: azureCogSearchEndpoint,
            key: azureCogSearchApiKey,
            indexName: azureCogSearchIndexName,
            semanticConfiguration: '',
            queryType: 'simple',
            fieldsMapping: {
                contentFieldsSeparator: '\n',
                contentFields: ['content'],
                filepathField: null,
                titleField: 'title',
                urlField: null
            },
            inScope: true,
            roleInformation: document.getElementById('prompt').value
        }
    });
}

// =================== HTML ENCODE HELPER ===================
function htmlEncode(text) {
    const entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;'
    };
    return String(text).replace(/[&<>"'\/]/g, (m) => entityMap[m]);
}

// =================== TTS FUNCTION ===================
function speak(text, endingSilenceMs = 0) {
    if (isSpeaking) {
        spokenTextQueue.push(text);
        return;
    }
    speakNext(text, endingSilenceMs);
}

function speakNext(text, endingSilenceMs = 0) {
    const ttsVoice = document.getElementById('ttsVoice').value.trim();
    // Removed personalVoiceSpeakerProfileID reference
    let ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis'
                     xmlns:mstts='http://www.w3.org/2001/mstts'
                     xml:lang='en-US'>
                  <voice name='${ttsVoice}'>
                    <mstts:ttsembedding>
                      <mstts:leadingsilence-exact value='0'/>
                      ${htmlEncode(text)}
                    </mstts:ttsembedding>
                  </voice>
                </speak>`;
    

    if (endingSilenceMs > 0) {
        ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis'
                     xmlns:mstts='http://www.w3.org/2001/mstts'
                     xml:lang='en-US'>
                  <voice name='${ttsVoice}'>
                    <mstts:ttsembedding>
                      <mstts:leadingsilence-exact value='0'/>
                      ${htmlEncode(text)}
                      <break time='${endingSilenceMs}ms' />
                    </mstts:ttsembedding>
                  </voice>
                </speak>`;
    }

    const chatHistoryTextArea = document.getElementById('chatHistory');
    if (enableDisplayTextAlignmentWithSpeech) {
        chatHistoryTextArea.innerHTML += text.replace(/\n/g, '<br/>');
        chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight;
    }

    lastSpeakTime = new Date();
    isSpeaking = true;
    speakingText = text;
    document.getElementById('stopSpeaking').disabled = false;

    avatarSynthesizer.speakSsmlAsync(ssml)
    .then(result => {
        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log(`Speech synthesized: ${text}, resultId: ${result.resultId}`);
            lastSpeakTime = new Date();
        } else {
            console.log(`Error speaking SSML. resultId: ${result.resultId}`);
        }
        if (spokenTextQueue.length > 0) {
            speakNext(spokenTextQueue.shift());
        } else {
            isSpeaking = false;
            document.getElementById('stopSpeaking').disabled = true;
        }
    })
    .catch(error => {
        console.log(`speakSsmlAsync error: ${error}`);
        if (spokenTextQueue.length > 0) {
            speakNext(spokenTextQueue.shift());
        } else {
            isSpeaking = false;
            document.getElementById('stopSpeaking').disabled = true;
        }
    });
}

function stopSpeaking() {
    spokenTextQueue = [];
    if (avatarSynthesizer) {
        avatarSynthesizer.stopSpeakingAsync()
        .then(() => {
            isSpeaking = false;
            document.getElementById('stopSpeaking').disabled = true;
            console.log('Stop speaking request sent.');
        })
        .catch(err => console.log(`Error stopping speaking: ${err}`));
    }
}

// =================== HANDLE USER QUERY ===================
function handleUserQuery(userQuery, userQueryHTML, imgUrlPath) {
    let contentMessage = userQuery;
    if (imgUrlPath.trim()) {
        contentMessage = [
            { type: "text", text: userQuery },
            { type: "image_url", image_url: { url: imgUrlPath } }
        ];
    }
    messages.push({ role: 'user', content: contentMessage });

    const chatHistoryTextArea = document.getElementById('chatHistory');
    if (chatHistoryTextArea.innerHTML !== '' && !chatHistoryTextArea.innerHTML.endsWith('\n\n')) {
        chatHistoryTextArea.innerHTML += '\n\n';
    }
    if (imgUrlPath.trim()) {
        chatHistoryTextArea.innerHTML += `<br/><br/>User: ${userQueryHTML}`;
    } else {
        chatHistoryTextArea.innerHTML += `<br/><br/>User: ${userQuery}<br/>`;
    }
    chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight;

    if (isSpeaking) stopSpeaking();
    if (dataSources.length > 0 && enableQuickReply) {
        speak(getQuickReply(), 2000);
    }

    const azureOpenAIEndpoint = document.getElementById('azureOpenAIEndpoint').value.trim();
    const azureOpenAIApiKey = document.getElementById('azureOpenAIApiKey').value.trim();
    const azureOpenAIDeploymentName = document.getElementById('azureOpenAIDeploymentName').value.trim();

    let url = `${azureOpenAIEndpoint}/openai/deployments/${azureOpenAIDeploymentName}/chat/completions?api-version=2023-06-01-preview`;
    let body = JSON.stringify({ messages, stream: true });

    if (dataSources.length > 0) {
        url = `${azureOpenAIEndpoint}/openai/deployments/${azureOpenAIDeploymentName}/extensions/chat/completions?api-version=2023-06-01-preview`;
        body = JSON.stringify({ dataSources, messages, stream: true });
    }

    let assistantReply = '';
    let toolContent = '';
    let spokenSentence = '';
    let displaySentence = '';

    fetch(url, {
        method: 'POST',
        headers: {
            'api-key': azureOpenAIApiKey,
            'Content-Type': 'application/json'
        },
        body
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Chat API response: ${response.status} ${response.statusText}`);
        }
        chatHistoryTextArea.innerHTML += `<br/>Assistant: `;
        const reader = response.body.getReader();

        function read(previousChunkString = '') {
            return reader.read().then(({ value, done }) => {
                if (done) return;
                let chunkString = new TextDecoder().decode(value, { stream: true });
                if (previousChunkString) chunkString = previousChunkString + chunkString;

                if (!chunkString.endsWith('}\n\n') && !chunkString.endsWith('[DONE]\n\n')) {
                    return read(chunkString);
                }
                chunkString.split('\n\n').forEach(line => {
                    if (line.startsWith('data:') && !line.endsWith('[DONE]')) {
                        try {
                            const responseJson = JSON.parse(line.substring(5).trim());
                            let responseToken;
                            if (dataSources.length === 0) {
                                responseToken = responseJson.choices[0].delta.content;
                            } else {
                                const role = responseJson.choices[0].messages[0].delta.role;
                                if (role === 'tool') {
                                    toolContent = responseJson.choices[0].messages[0].delta.content;
                                } else {
                                    responseToken = responseJson.choices[0].messages[0].delta.content || '';
                                    if (byodDocRegex.test(responseToken)) {
                                        responseToken = responseToken.replace(byodDocRegex, '').trim();
                                    }
                                    if (responseToken === '[DONE]') responseToken = undefined;
                                }
                            }
                            if (responseToken) {
                                assistantReply += responseToken;
                                displaySentence += responseToken;
                                if (responseToken === '\n' || responseToken === '\n\n') {
                                    spokenSentence += responseToken;
                                    speak(spokenSentence);
                                    spokenSentence = '';
                                } else {
                                    spokenSentence += responseToken;
                                    const trimmed = responseToken.replace(/\n/g, '');
                                    if (trimmed.length <= 2) {
                                        for (let punct of sentenceLevelPunctuations) {
                                            if (trimmed.startsWith(punct)) {
                                                speak(spokenSentence);
                                                spokenSentence = '';
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                            console.log('Error parsing chunk: ' + err);
                        }
                    }
                });
                if (!enableDisplayTextAlignmentWithSpeech) {
                    chatHistoryTextArea.innerHTML += displaySentence.replace(/\n/g, '<br/>');
                    chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight;
                    displaySentence = '';
                }
                return read();
            });
        }
        return read();
    })
    .then(() => {
        if (spokenSentence) {
            speak(spokenSentence);
            spokenSentence = '';
        }
        if (dataSources.length > 0 && toolContent) {
            messages.push({ role: 'tool', content: toolContent });
        }
        messages.push({ role: 'assistant', content: assistantReply });
    })
    .catch(err => console.log('fetch error: ' + err));
}

function getQuickReply() {
    return quickReplies[Math.floor(Math.random() * quickReplies.length)];
}

// =================== HUNG & IDLE CHECKS ===================
function checkHung() {
    const videoElement = document.getElementById('videoPlayer');
    if (videoElement && sessionActive) {
        const videoTime = videoElement.currentTime;
        setTimeout(() => {
            if (videoElement.currentTime === videoTime && sessionActive) {
                sessionActive = false;
                console.log('Video stream disconnected, auto reconnecting...');
                if (avatarSynthesizer) avatarSynthesizer.close();
                connectAvatar();
            }
        }, 2000);
    }
}

function checkLastSpeak() {
    if (!lastSpeakTime) return;
    const now = new Date();
    if (now - lastSpeakTime > 15000) {
        disconnectAvatar();
        document.getElementById('localVideo').hidden = false;
        document.getElementById('remoteVideo').style.width = '0.1px';
        sessionActive = false;
    }
}

window.onload = () => {
    setInterval(() => {
        checkHung();
        checkLastSpeak();
    }, 2000);
};

// =================== BUTTONS / UI ACTIONS ===================
window.startSession = () => {
    document.getElementById('openSessionButton').disabled = true;
    document.getElementById('openSessionButton').hidden = true;
    document.getElementById('configuration').hidden = true;
    document.getElementById('buttonContainer').hidden = false;
    document.getElementById('videoContainer').hidden = false;
    connectAvatar();
};

window.stopSession = () => {
    document.getElementById('openSessionButton').disabled = false;
    document.getElementById('openSessionButton').hidden = false;
    document.getElementById('configuration').hidden = false;
    document.getElementById('buttonContainer').hidden = true;
    document.getElementById('videoContainer').hidden = true;
    document.getElementById('microphone').disabled = true;
    document.getElementById('stopSession').disabled = true;
    document.getElementById('chatHistory').hidden = true;
    document.getElementById('userMessageBox').hidden = true;
    document.getElementById('uploadImgIcon').hidden = true;
    document.getElementById('localVideo').hidden = true;
    disconnectAvatar();
};

window.clearChatHistory = () => {
    document.getElementById('chatHistory').innerHTML = '';
    initMessages();
};

window.microphone = () => {
    const micBtn = document.getElementById('microphone');
    if (micBtn.innerHTML === 'Stop Microphone') {
        micBtn.disabled = true;
        speechRecognizer.stopContinuousRecognitionAsync(() => {
            micBtn.innerHTML = 'Start Microphone';
            micBtn.disabled = false;
        }, err => {
            console.log("Failed to stop recognition:", err);
            micBtn.disabled = false;
        });
        return;
    }
    micBtn.disabled = true;
    speechRecognizer.recognized = async (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
            const userQuery = e.result.text.trim();
            if (!userQuery) return;
            micBtn.disabled = true;
            speechRecognizer.stopContinuousRecognitionAsync(() => {
                micBtn.innerHTML = 'Start Microphone';
                micBtn.disabled = false;
            }, err => {
                console.log("Error stopping recognition:", err);
                micBtn.disabled = false;
            });
            handleUserQuery(userQuery, "", "");
        }
    };
    speechRecognizer.startContinuousRecognitionAsync(() => {
        micBtn.innerHTML = 'Stop Microphone';
        micBtn.disabled = false;
    }, err => {
        console.log("Failed to start recognition:", err);
        micBtn.disabled = false;
    });
};

// On Your Data toggle
window.updataEnableOyd = () => {
    const show = document.getElementById('enableOyd').checked;
    document.getElementById('cogSearchConfig').hidden = !show;
};

// Type message toggle
window.updateTypeMessageBox = () => {
    const check = document.getElementById('showTypeMessage').checked;
    if (check) {
        document.getElementById('userMessageBox').hidden = false;
        document.getElementById('uploadImgIcon').hidden = false;
        document.getElementById('userMessageBox').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                const userQuery = document.getElementById('userMessageBox').innerText;
                const messageBox = document.getElementById('userMessageBox');
                const childImg = messageBox.querySelector("#picInput");
                if (childImg) {
                    childImg.style.width = "200px";
                    childImg.style.height = "200px";
                }
                let userQueryHTML = messageBox.innerHTML.trim();
                if (userQueryHTML.startsWith('<img')) {
                    userQueryHTML = "<br/>" + userQueryHTML;
                }
                if (userQuery) {
                    handleUserQuery(userQuery, userQueryHTML, imgUrl);
                    messageBox.innerHTML = '';
                    imgUrl = "";
                }
            }
        });
        document.getElementById('uploadImgIcon').addEventListener('click', function() {
            imgUrl = "https://wallpaperaccess.com/full/528436.jpg";
            const userMessage = document.getElementById("userMessageBox");
            const childImg = userMessage.querySelector("#picInput");
            if (childImg) userMessage.removeChild(childImg);
            userMessage.innerHTML += `<br/><img id="picInput" src="https://wallpaperaccess.com/full/528436.jpg" style="width:100px;height:100px"/><br/><br/>`;
        });
    } else {
        document.getElementById('userMessageBox').hidden = true;
        document.getElementById('uploadImgIcon').hidden = true;
        imgUrl = "";
    }
};
