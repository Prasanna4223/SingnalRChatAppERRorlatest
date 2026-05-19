// ═══════════════════════════════════════════════════════
//  SignalR Video Chat - app.js (complete rewrite)
// ═══════════════════════════════════════════════════════

// ─── State ───
let myId = null;
let myName = "";
let selectedUserId = null;
let currentPeerId = null;
let peerConnection = null;
let localStream = null;
let localHasVideo = false;
let localHasAudio = false;
let isInCall = false;

// ─── SignalR Hub ───
const hub = new signalR.HubConnectionBuilder()
    .withUrl("/callHub")
    .withAutomaticReconnect()
    .build();

// ─── DOM Elements ───
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const chatMessages = document.getElementById("chatMessages");
const messageInput = document.getElementById("message");
const userListEl = document.getElementById("activeUsersList");
const endCallBtn = document.getElementById("endCall");
const toggleVideoBtn = document.getElementById("toggleVideo");
const toggleAudioBtn = document.getElementById("toggleAudio");

// ─── ICE Configuration ───
const ICE_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

// ═══════════════════════════════════════════════════════
//  1. JOIN / REGISTRATION
// ═══════════════════════════════════════════════════════

// DND Toggle
const dndToggle = document.createElement("button");
dndToggle.className = "dnd-toggle";
dndToggle.textContent = "🟢 Available";
dndToggle.onclick = () => {
    const isOn = dndToggle.classList.toggle("on");
    dndToggle.textContent = isOn ? "🔴 Do Not Disturb" : "🟢 Available";
    hub.invoke("ToggleDnd", isOn);
};
document.querySelector(".sidebar").prepend(dndToggle);

// Join button
document.getElementById("joinBtn").onclick = async () => {
    myName = document.getElementById("displayname").value.trim();
    if (!myName) return alert("Please enter your name!");

    try {
        await hub.start();
        myId = await hub.invoke("Register", myName);
        document.querySelector(".username-popup").style.display = "none";
        console.log("Joined as:", myName, "| ID:", myId);
    } catch (err) {
        console.error("Connection failed:", err);
        alert("Failed to connect: " + err.toString());
    }
};

// Enter key to join
document.getElementById("displayname").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("joinBtn").click();
});

// ═══════════════════════════════════════════════════════
//  2. USER LIST (receives array of user objects)
// ═══════════════════════════════════════════════════════

hub.on("UserListUpdated", (users) => {
    userListEl.innerHTML = "";

    users.forEach(user => {
        const li = document.createElement("li");
        li.dataset.id = user.id;

        const displayName = user.name || "Anonymous";
        let statusIcons = "";
        if (user.isDoNotDisturb) statusIcons += " 🚫";
        if (user.isInCall) statusIcons += " 📞";

        li.innerHTML = `<span class="user-name">${displayName}</span><span class="user-status">${statusIcons}</span>`;

        if (user.isInCall) li.classList.add("user-busy");

        // Identify self
        if (user.id === myId) {
            li.classList.add("current-user");
            li.innerHTML += ` <span class="badge">(You)</span>`;
        } else {
            // Click to select
            li.onclick = () => {
                document.querySelectorAll("#activeUsersList li").forEach(x => x.classList.remove("selected"));
                li.classList.add("selected");
                selectedUserId = user.id;
            };

            // Double-click to call
            li.ondblclick = () => {
                if (user.isInCall || user.isDoNotDisturb) {
                    showNotification("User is busy or unavailable", "warning");
                    return;
                }
                initiateCall(user.id, displayName);
            };

            // Right-click context menu
            li.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                showContextMenu(e, user.id, displayName, user.isInCall, user.isDoNotDisturb);
            });
        }

        userListEl.appendChild(li);
    });
});

// ═══════════════════════════════════════════════════════
//  3. CONTEXT MENU
// ═══════════════════════════════════════════════════════

function showContextMenu(event, userId, userName, userInCall, isDnd) {
    // Remove any existing menu
    document.querySelectorAll(".context-menu").forEach(m => m.remove());

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = event.clientX + "px";
    menu.style.top = event.clientY + "px";

    // Call option
    const callOption = document.createElement("div");
    callOption.className = "context-menu-item";
    callOption.innerHTML = "📞 Call";
    if (userInCall || isDnd || isInCall) {
        callOption.classList.add("disabled");
        callOption.title = userInCall ? "User is busy" : isDnd ? "User has DND on" : "You are in a call";
    } else {
        callOption.onclick = () => { initiateCall(userId, userName); menu.remove(); };
    }

    // Message option
    const msgOption = document.createElement("div");
    msgOption.className = "context-menu-item";
    msgOption.innerHTML = "💬 Message";
    msgOption.onclick = () => {
        selectedUserId = userId;
        document.querySelectorAll("#activeUsersList li").forEach(x => x.classList.remove("selected"));
        const targetLi = document.querySelector(`#activeUsersList li[data-id="${userId}"]`);
        if (targetLi) targetLi.classList.add("selected");
        messageInput.focus();
        menu.remove();
    };

    menu.appendChild(callOption);
    menu.appendChild(msgOption);
    document.body.appendChild(menu);

    // Close menu on any click
    setTimeout(() => {
        document.addEventListener("click", function closeMenu() {
            menu.remove();
            document.removeEventListener("click", closeMenu);
        });
    }, 50);
}

// ═══════════════════════════════════════════════════════
//  4. CALLING — Outgoing
// ═══════════════════════════════════════════════════════

async function initiateCall(userId, userName) {
    if (isInCall || peerConnection) {
        showNotification("You are already in a call!", "warning");
        return;
    }

    selectedUserId = userId;
    currentPeerId = userId;

    try {
        await startLocalStream(true, true);
        showNotification(`Calling ${userName}...`, "info");

        createPeerConnection();

        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await peerConnection.setLocalDescription(offer);

        // Send offer as plain object (SignalR serializes it)
        await hub.invoke("SendOffer", userId,
            { type: offer.type, sdp: offer.sdp },
            localHasVideo, localHasAudio
        );
    } catch (err) {
        console.error("Failed to initiate call:", err);
        showNotification("Failed to start call: " + err.message, "error");
        cleanupCall();
    }
}

// ═══════════════════════════════════════════════════════
//  5. CALLING — Incoming
// ═══════════════════════════════════════════════════════

hub.on("IncomingCall", (callerId, callerName, offer, hasVideo, hasAudio) => {
    console.log("📞 Incoming call from:", callerName);

    if (isInCall) {
        hub.invoke("RejectCall", callerId, "User is busy");
        return;
    }

    currentPeerId = callerId;

    // Build media info string
    const mediaInfo = [];
    if (hasVideo) mediaInfo.push("📹 Video");
    if (hasAudio) mediaInfo.push("🎤 Audio");

    document.getElementById("callerName").textContent = callerName;
    document.getElementById("callMediaInfo").textContent = mediaInfo.join(" + ") || "Call";
    document.getElementById("incomingCallPopup").classList.add("show");

    // Accept handler
    document.getElementById("acceptCallPopup").onclick = async () => {
        document.getElementById("incomingCallPopup").classList.remove("show");
        try {
            await startLocalStream(true, true);
            createPeerConnection();

            // Set remote description from offer
            const offerDesc = new RTCSessionDescription(offer);
            await peerConnection.setRemoteDescription(offerDesc);

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            await hub.invoke("AcceptCall", callerId);
            await hub.invoke("SendAnswer", callerId,
                { type: answer.type, sdp: answer.sdp },
                localHasVideo, localHasAudio
            );

            isInCall = true;
            showCallControls();
            showNotification("Call connected!", "success");
        } catch (err) {
            console.error("Failed to accept call:", err);
            hub.invoke("RejectCall", callerId, "Connection failed");
            cleanupCall();
        }
    };

    // Reject handler
    document.getElementById("rejectCallPopup").onclick = async () => {
        document.getElementById("incomingCallPopup").classList.remove("show");
        await hub.invoke("RejectCall", callerId, "Call declined");
        currentPeerId = null;
    };
});

// ═══════════════════════════════════════════════════════
//  6. SIGNALING — Answer, ICE, Call State
// ═══════════════════════════════════════════════════════

hub.on("CallAccepted", (calleeId) => {
    console.log("✅ Call accepted by:", calleeId);
    isInCall = true;
    showCallControls();
    showNotification("Call accepted!", "success");
});

hub.on("ReceiveAnswer", async (answer, hasVideo, hasAudio) => {
    if (!peerConnection) return;
    try {
        const answerDesc = new RTCSessionDescription(answer);
        await peerConnection.setRemoteDescription(answerDesc);
        console.log("Remote answer set successfully");
    } catch (err) {
        console.error("Failed to set remote answer:", err);
    }
});

hub.on("ReceiveIceCandidate", async (senderId, candidate) => {
    if (!peerConnection) return;
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
        console.error("Failed to add ICE candidate:", err);
    }
});

hub.on("CallRejected", (reason) => {
    showNotification(reason || "Call rejected", "warning");
    cleanupCall();
});

hub.on("CallEnded", () => {
    showNotification("Call ended", "info");
    cleanupCall();
});

// Peer media toggles
hub.on("PeerVideoToggled", (enabled) => {
    const remoteStream = remoteVideo.srcObject;
    if (remoteStream) {
        remoteStream.getVideoTracks().forEach(t => t.enabled = enabled);
    }
    showNotification(enabled ? "Peer turned on video" : "Peer turned off video", "info");
});

hub.on("PeerAudioToggled", (enabled) => {
    const remoteStream = remoteVideo.srcObject;
    if (remoteStream) {
        remoteStream.getAudioTracks().forEach(t => t.enabled = enabled);
    }
    showNotification(enabled ? "Peer unmuted" : "Peer muted", "info");
});

// ═══════════════════════════════════════════════════════
//  7. WEBRTC — Media & PeerConnection
// ═══════════════════════════════════════════════════════

async function startLocalStream(requestVideo, requestAudio) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: requestVideo ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
            audio: requestAudio
        });
        localVideo.srcObject = localStream;
        localHasVideo = requestVideo && localStream.getVideoTracks().length > 0;
        localHasAudio = requestAudio && localStream.getAudioTracks().length > 0;
    } catch (err) {
        console.warn("Media access failed:", err);
        localHasVideo = false;
        localHasAudio = false;
        showNotification("Camera/Mic access denied. Audio-only mode.", "warning");
    }
}

function createPeerConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    peerConnection = new RTCPeerConnection(ICE_CONFIG);

    // Add local tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Receive remote tracks
    peerConnection.ontrack = (event) => {
        console.log("Remote track received:", event.track.kind);
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    // Send ICE candidates to peer
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && currentPeerId) {
            hub.invoke("SendIceCandidate", currentPeerId, event.candidate.toJSON())
                .catch(err => console.error("ICE send failed:", err));
        }
    };

    // Monitor connection state
    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection?.connectionState;
        console.log("WebRTC state:", state);
        if (state === "failed" || state === "disconnected") {
            showNotification("Connection lost", "warning");
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE state:", peerConnection?.iceConnectionState);
    };
}

// ═══════════════════════════════════════════════════════
//  8. CALL CONTROLS
// ═══════════════════════════════════════════════════════

// End call
endCallBtn.onclick = () => {
    if (currentPeerId) {
        hub.invoke("EndCall", currentPeerId).catch(console.error);
    }
    cleanupCall();
};

// Toggle video
toggleVideoBtn.onclick = () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    videoTrack.enabled = !videoTrack.enabled;
    localHasVideo = videoTrack.enabled;
    toggleVideoBtn.textContent = videoTrack.enabled ? "📹 Video On" : "📹 Video Off";
    toggleVideoBtn.classList.toggle("toggled-off", !videoTrack.enabled);

    if (currentPeerId) {
        hub.invoke("ToggleVideo", currentPeerId, videoTrack.enabled).catch(console.error);
    }
};

// Toggle audio
toggleAudioBtn.onclick = () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    audioTrack.enabled = !audioTrack.enabled;
    localHasAudio = audioTrack.enabled;
    toggleAudioBtn.textContent = audioTrack.enabled ? "🎤 Mic On" : "🎤 Mic Off";
    toggleAudioBtn.classList.toggle("toggled-off", !audioTrack.enabled);

    if (currentPeerId) {
        hub.invoke("ToggleAudio", currentPeerId, audioTrack.enabled).catch(console.error);
    }
};

function showCallControls() {
    document.querySelector(".video-container").style.display = "flex";
    endCallBtn.classList.add("active");
    toggleVideoBtn.classList.add("active");
    toggleAudioBtn.classList.add("active");
    toggleVideoBtn.textContent = "📹 Video On";
    toggleAudioBtn.textContent = "🎤 Mic On";
}

function hideCallControls() {
    document.querySelector(".video-container").style.display = "none";
    endCallBtn.classList.remove("active");
    toggleVideoBtn.classList.remove("active");
    toggleAudioBtn.classList.remove("active");
}

// ═══════════════════════════════════════════════════════
//  9. CLEANUP
// ═══════════════════════════════════════════════════════

function cleanupCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    currentPeerId = null;
    isInCall = false;
    localHasVideo = false;
    localHasAudio = false;
    hideCallControls();
}

// ═══════════════════════════════════════════════════════
//  10. PRIVATE CHAT
// ═══════════════════════════════════════════════════════

document.getElementById("sendmessage").onclick = sendMessage;
messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
});

function sendMessage() {
    const msg = messageInput.value.trim();
    if (!msg) return;
    if (!selectedUserId) {
        showNotification("Select a user first!", "warning");
        return;
    }
    hub.invoke("SendPrivateMessage", selectedUserId, msg);
    messageInput.value = "";
}

hub.on("ReceivePrivateMessage", (sender, message, timestamp, peerId) => {
    const div = document.createElement("div");
    div.className = sender === "You" ? "msg msg-sent" : "msg msg-received";
    div.innerHTML = `<strong>${sender}</strong> <small>${timestamp}</small><br>${escapeHtml(message)}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

// ═══════════════════════════════════════════════════════
//  11. UTILITIES
// ═══════════════════════════════════════════════════════

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    requestAnimationFrame(() => notification.classList.add("show"));
    setTimeout(() => {
        notification.classList.remove("show");
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// ═══════════════════════════════════════════════════════
//  12. RECONNECTION HANDLING
// ═══════════════════════════════════════════════════════

hub.onreconnected(async (connectionId) => {
    console.log("Reconnected with ID:", connectionId);
    myId = connectionId;
    if (myName) {
        await hub.invoke("Register", myName);
    }
    // If was in a call, it's gone now
    cleanupCall();
    showNotification("Reconnected!", "success");
});

hub.onclose(() => {
    console.log("Hub connection closed");
    cleanupCall();
    showNotification("Connection lost. Attempting to reconnect...", "error");
});
