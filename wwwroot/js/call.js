let localStream;
let peerConnection;
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

async function startLocalStream() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
}

callHub.on("ReceiveOffer", async (callerId, offer) => {
    await startLocalStream();
    peerConnection = new RTCPeerConnection(config);

    // Add tracks
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.onicecandidate = e => {
        if (e.candidate) callHub.invoke("SendIceCandidate", callerId, JSON.stringify(e.candidate));
    };

    peerConnection.ontrack = e => remoteVideo.srcObject = e.streams[0];

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await callHub.invoke("SendAnswer", callerId, answer);
});

callHub.on("ReceiveAnswer", async (answer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

callHub.on("ReceiveIceCandidate", async (senderId, candidate) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
    }
});

// Start call
document.getElementById("activeUsersList").onclick = async () => {
    if (!selectedUserId) return;
    await startLocalStream();
    peerConnection = new RTCPeerConnection(config);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.onicecandidate = e => {
        if (e.candidate) callHub.invoke("SendIceCandidate", selectedUserId, JSON.stringify(e.candidate));
    };
    peerConnection.ontrack = e => remoteVideo.srcObject = e.streams[0];

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await callHub.invoke("SendOffer", selectedUserId, offer);
};

