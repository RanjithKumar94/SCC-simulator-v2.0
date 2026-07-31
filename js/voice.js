// ======================================
// voice.js
// Push-to-talk voice control: speech-to-text
// command parsing/execution, AI pilot
// readbacks (speech synthesis), automatic
// radio calls, and a transmission transcript.
//
// Uses the browser's built-in Web Speech API
// (SpeechRecognition + SpeechSynthesis) - no
// external service required. Recognition is
// currently only supported in Chrome/Edge.
// ======================================

// ======================================
// Transcript
// ======================================

let transcriptLog = [];

function getSimTimeString(){

    if(typeof simHour === "undefined") return "--:--:--";

    return String(simHour).padStart(2,"0") + ":" +
           String(simMinute).padStart(2,"0") + ":" +
           String(simSecond).padStart(2,"0");

}

function logTransmission(speaker, callsign, text){

    transcriptLog.push({
        time: getSimTimeString(),
        speaker: speaker,       // "ATC" or "PILOT"
        callsign: callsign,
        text: text
    });

    renderTranscript();

}

function renderTranscript(){

    const box = document.getElementById("transcriptBox");

    if(!box) return;

    box.innerHTML = transcriptLog.map(line=>{

        const cls = line.speaker === "ATC" ? "tAtc" : "tPilot";

        return '<div class="transcriptLine">' +
            '<span class="tTime">' + line.time + '</span> ' +
            '<span class="' + cls + '">' + line.speaker + ' ' + line.callsign + '</span>: ' +
            line.text +
            '</div>';

    }).join("");

    box.scrollTop = box.scrollHeight;

}

function downloadTranscript(){

    let out = "ATC RADIO TRANSCRIPT\n";
    out += "Generated at " + getSimTimeString() + "\n";
    out += "=====================================\n\n";

    transcriptLog.forEach(line=>{
        out += "[" + line.time + "] " + line.speaker + " " + line.callsign + ": " + line.text + "\n";
    });

    const blob = new Blob([out], {type:"text/plain"});
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "atc_transcript_" + getSimTimeString().replace(/:/g,"") + ".txt";
    a.click();

    URL.revokeObjectURL(url);

}

// ======================================
// Spoken number helper (aviation style:
// digit by digit, "niner" for 9)
// ======================================

const DIGIT_WORDS = {
    "0":"zero", "1":"one", "2":"two", "3":"three", "4":"four",
    "5":"five", "6":"six", "7":"seven", "8":"eight", "9":"niner"
};

function spokenDigits(n){

    return String(Math.round(n)).split("").map(d => DIGIT_WORDS[d] || d).join(" ");

}

// ======================================
// Text to speech (pilot voice)
// ======================================

function speak(text){

    if(!("speechSynthesis" in window)) return;

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    utter.pitch = 1.0;

    // Prefer a male-sounding English voice if available
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v => /en-/i.test(v.lang) && /male/i.test(v.name));

    if(preferred) utter.voice = preferred;

    speechSynthesis.speak(utter);

}

// ======================================
// Find aircraft by spoken callsign
// (lenient match - speech recognition
// often mangles letter/number callsigns)
// ======================================

function findAircraftBySpokenCallsign(text){

    const activeList = [
        ...(typeof aircraft !== "undefined" ? aircraft : []),
        ...(typeof departures !== "undefined" ? departures : [])
    ].filter(ac => ac.active);

    const normalizedText = text.toUpperCase().replace(/[^A-Z0-9]/g, "");

    let best = null;
    let bestLen = 0;

    activeList.forEach(ac=>{

        const cs = ac.callsign.toUpperCase().replace(/[^A-Z0-9]/g, "");

        if(normalizedText.includes(cs) && cs.length > bestLen){
            best = ac;
            bestLen = cs.length;
        }

    });

    return best;

}

// ======================================
// Parse a spoken ATC instruction into a
// structured command
// ======================================

function parseATCCommand(rawText){

    const text = rawText.toLowerCase();

    const cmd = {
        raw: rawText,
        heading: null,
        turnDirection: null,
        level: null,
        levelAction: null,    // "climb" | "descend"
        speed: null,
        squawk: null,
        directToFix: null,
        intercept: false,
        discontinue: false,
        mayday: false,
        panPan: false
    };

    // Heading
    const hdgMatch = text.match(/heading\s*(\d{1,3})/);
    if(hdgMatch){
        cmd.heading = parseInt(hdgMatch[1]) % 360;

        const beforeHdg = text.slice(0, hdgMatch.index);
        if(/left[^.]{0,15}$/.test(beforeHdg)) cmd.turnDirection = "LEFT";
        else if(/right[^.]{0,15}$/.test(beforeHdg)) cmd.turnDirection = "RIGHT";
        else cmd.turnDirection = "SHORTEST";
    }

    // Level (flight level or feet)
    const flMatch = text.match(/flight level\s*(\d{1,3})/);
    const ftMatch = text.match(/(\d{3,5})\s*feet/);

    if(flMatch){
        cmd.level = parseInt(flMatch[1]);
    }
    else if(ftMatch){
        cmd.level = Math.round(parseInt(ftMatch[1]) / 100);
    }

    if(cmd.level !== null){
        if(/descend/.test(text)) cmd.levelAction = "descend";
        else if(/climb/.test(text)) cmd.levelAction = "climb";
    }

    // Speed
    const spdMatch = text.match(/speed\s*(\d{2,3})/);
    if(spdMatch){
        cmd.speed = parseInt(spdMatch[1]);
    }

    // Squawk
    const sqMatch = text.match(/squawk\s*(\d{4})/);
    if(sqMatch){
        cmd.squawk = sqMatch[1];
    }

    // Direct to fix
    const fixNames = (typeof FIXES !== "undefined") ? FIXES.map(f => f.name) : [];
    const dctMatch = text.match(/direct\s+([a-z]+)/);

    if(dctMatch){
        const spoken = dctMatch[1].toUpperCase();
        const match = fixNames.find(f => f === spoken || f.startsWith(spoken));
        if(match) cmd.directToFix = match;
    }

    // Intercept / vectors to final
    if(/intercept|localiser|localizer|vector/.test(text)){
        cmd.intercept = true;
    }

    // Go-around / discontinue
    if(/go\s*around|discontinue/.test(text)){
        cmd.discontinue = true;
    }

    // Emergency
    if(/mayday/.test(text)) cmd.mayday = true;
    if(/pan\s*pan/.test(text)) cmd.panPan = true;

    return cmd;

}

// ======================================
// Execute a parsed command against an
// aircraft, and generate the dynamic
// pilot readback
// ======================================

function executeATCCommand(ac, cmd){

    const readbackParts = [];

    if(cmd.heading !== null){

        ac.targetHeading = cmd.heading;
        ac.turnDirection = cmd.turnDirection || "SHORTEST";
        ac.directToFix = null;
        ac.viaDumasRoute = false;

        const dirWord =
            ac.turnDirection === "LEFT" ? "Left heading " :
            ac.turnDirection === "RIGHT" ? "Right heading " :
            "Heading ";

        readbackParts.push(dirWord + spokenDigits(cmd.heading));

        if(cmd.intercept){
            ac.locIntercept = true;
            ac.established = false;
            ac.targetLevel = Math.min(ac.targetLevel, 20);
            readbackParts.push("vectors to intercept");
        }

    }

    if(cmd.level !== null){

        ac.targetLevel = cmd.level;

        const action = cmd.levelAction ||
            (cmd.level > ac.level ? "climb" : "descend");

        readbackParts.push(
            (action === "climb" ? "Climb Flight Level " : "Descend Flight Level ") +
            spokenDigits(cmd.level)
        );

    }

    if(cmd.speed !== null){

        ac.targetSpeed = cmd.speed;
        readbackParts.push("Speed " + spokenDigits(cmd.speed));

    }

    if(cmd.squawk !== null){

        ac.squawk = cmd.squawk;
        readbackParts.push("Squawk " + spokenDigits(parseInt(cmd.squawk)));

    }

    if(cmd.directToFix !== null){

        ac.directToFix = cmd.directToFix;
        ac.established = false;
        ac.locIntercept = false;
        ac.viaDumasRoute = false;

        readbackParts.push("Direct " + cmd.directToFix);

    }

    if(cmd.discontinue){

        ac.locIntercept = false;
        ac.established = false;
        ac.approach = false;
        ac.arrivalPhase = false;
        ac.viaDumasRoute = false;
        ac.directToFix = null;
        ac.targetHeading = Math.round(ac.heading) % 360;
        ac.turnDirection = "SHORTEST";
        ac.targetLevel = Math.round(ac.level) + 20;

        readbackParts.push("Going around");

    }

    if(readbackParts.length === 0){
        readbackParts.push("Say again");
    }

    const readback = readbackParts.join(", ") + ", " + ac.callsign;

    logTransmission("PILOT", ac.callsign, readback);
    speak(readback);

}

// ======================================
// Push To Talk + Speech Recognition
// ======================================

let recognition = null;
let recognizing = false;

function initSpeechRecognition(){

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    if(!SR){
        const status = document.getElementById("voiceStatus");
        if(status) status.textContent = "Speech recognition not supported in this browser (try Chrome)";
        return;
    }

    recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = function(event){

        const transcript = event.results[0][0].transcript;

        const status = document.getElementById("voiceStatus");
        if(status) status.textContent = 'Heard: "' + transcript + '"';

        handleControllerTransmission(transcript);

    };

    recognition.onerror = function(event){

        const status = document.getElementById("voiceStatus");
        if(status) status.textContent = "Mic error: " + event.error;

    };

    recognition.onend = function(){

        recognizing = false;

        const btn = document.getElementById("pttBtn");
        if(btn) btn.classList.remove("pttActive");

    };

}

function handleControllerTransmission(transcript){

    const ac = findAircraftBySpokenCallsign(transcript);

    if(!ac){

        logTransmission("ATC", "(unknown)", transcript);

        const status = document.getElementById("voiceStatus");
        if(status) status.textContent = "No matching aircraft found for that callsign";

        return;

    }

    logTransmission("ATC", ac.callsign, transcript);

    const cmd = parseATCCommand(transcript);

    if(cmd.mayday){
        logTransmission("PILOT", ac.callsign, "Mayday, Mayday, Mayday, " + ac.callsign);
        speak("Mayday, Mayday, Mayday, " + ac.callsign);
        return;
    }

    if(cmd.panPan){
        logTransmission("PILOT", ac.callsign, "Pan Pan, Pan Pan, Pan Pan, " + ac.callsign);
        speak("Pan Pan, Pan Pan, Pan Pan, " + ac.callsign);
        return;
    }

    executeATCCommand(ac, cmd);

}

function startPTT(){

    if(!recognition) initSpeechRecognition();
    if(!recognition || recognizing) return;

    recognizing = true;

    const btn = document.getElementById("pttBtn");
    if(btn) btn.classList.add("pttActive");

    const status = document.getElementById("voiceStatus");
    if(status) status.textContent = "Listening...";

    try{
        recognition.start();
    }catch(e){
        // already started - ignore
    }

}

function stopPTT(){

    if(recognition && recognizing){
        recognition.stop();
    }

}

// ======================================
// Manual emergency buttons
// ======================================

function announceMayday(){

    if(selectedAircraft == null){
        alert("Select an aircraft first.");
        return;
    }

    const text = "Mayday, Mayday, Mayday, " + selectedAircraft.callsign;
    logTransmission("PILOT", selectedAircraft.callsign, text);
    speak(text);

}

function announcePanPan(){

    if(selectedAircraft == null){
        alert("Select an aircraft first.");
        return;
    }

    const text = "Pan Pan, Pan Pan, Pan Pan, " + selectedAircraft.callsign;
    logTransmission("PILOT", selectedAircraft.callsign, text);
    speak(text);

}

// ======================================
// Automatic radio calls, driven by
// aircraft state changes each tick
// ======================================

function checkAutoRadioCalls(){

    const activeList = [
        ...(typeof aircraft !== "undefined" ? aircraft : []),
        ...(typeof departures !== "undefined" ? departures : [])
    ];

    activeList.forEach(ac=>{

        if(!ac.active) return;

        // Initial check-in
        if(!ac.radioCheckedIn){

            ac.radioCheckedIn = true;

            const text = ac.callsign + ", level " + spokenDigits(Math.round(ac.level)) +
                (ac.squawk ? ", squawk " + spokenDigits(parseInt(ac.squawk)) : "");

            logTransmission("PILOT", ac.callsign, text);
            speak(text);

        }

        // Passing/reaching assigned level
        if(Math.round(ac.level) === Math.round(ac.targetLevel) &&
           ac.verticalSpeed === 0 &&
           ac.radioLastLevelCalled !== Math.round(ac.targetLevel)){

            ac.radioLastLevelCalled = Math.round(ac.targetLevel);

            const text = ac.callsign + ", level " + spokenDigits(Math.round(ac.level));

            logTransmission("PILOT", ac.callsign, text);
            speak(text);

        }

        // Established on localiser
        if(ac.established && !ac.radioEstablishedCalled){

            ac.radioEstablishedCalled = true;

            const text = ac.callsign + ", established localiser";

            logTransmission("PILOT", ac.callsign, text);
            speak(text);

        }

        if(!ac.established){
            ac.radioEstablishedCalled = false;
        }

        // Established on the approach / glidepath (final)
        if(ac.approach && !ac.radioApproachCalled){

            ac.radioApproachCalled = true;

            const text = ac.callsign + ", established, final approach";

            logTransmission("PILOT", ac.callsign, text);
            speak(text);

        }

        if(!ac.approach){
            ac.radioApproachCalled = false;
        }

    });

}

// ======================================
// Wire up buttons
// ======================================

window.addEventListener("DOMContentLoaded", function(){

    const pttBtn = document.getElementById("pttBtn");

    if(pttBtn){

        pttBtn.addEventListener("mousedown", startPTT);
        pttBtn.addEventListener("touchstart", function(e){ e.preventDefault(); startPTT(); });

        pttBtn.addEventListener("mouseup", stopPTT);
        pttBtn.addEventListener("mouseleave", stopPTT);
        pttBtn.addEventListener("touchend", function(e){ e.preventDefault(); stopPTT(); });

    }

    const downloadBtn = document.getElementById("downloadTranscriptBtn");
    if(downloadBtn) downloadBtn.onclick = downloadTranscript;

    const maydayBtn = document.getElementById("maydayBtn");
    if(maydayBtn) maydayBtn.onclick = announceMayday;

    const panPanBtn = document.getElementById("panPanBtn");
    if(panPanBtn) panPanBtn.onclick = announcePanPan;

    const transcriptToggle = document.getElementById("transcriptToggle");
    const transcriptBox = document.getElementById("transcriptBox");

    if(transcriptToggle && transcriptBox){

        transcriptToggle.onclick = function(){

            const collapsed = transcriptBox.style.display === "none";
            transcriptBox.style.display = collapsed ? "block" : "none";
            transcriptToggle.textContent = "Transcript " + (collapsed ? "▾" : "▸");

        };

    }

    initSpeechRecognition();

});
