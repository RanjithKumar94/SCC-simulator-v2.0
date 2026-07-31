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

// Converts a raw callsign (e.g. "IGO121") into how it's
// actually spoken over the radio (e.g. "IFLY one two one").
// Known airline prefixes use their real RT callsign; unknown
// ones fall back to spelling the letters phonetically.
function spokenCallsign(callsign){

    const match = callsign.match(/^([A-Za-z]+)(\d+)$/);

    if(!match){
        return callsign;   // not in the expected format - just say it as-is
    }

    const alpha = match[1].toUpperCase();
    const digits = match[2];

    let alphaSpoken;

    if(typeof AIRLINE_CALLSIGNS !== "undefined" && AIRLINE_CALLSIGNS[alpha]){

        alphaSpoken = AIRLINE_CALLSIGNS[alpha];

    }
    else{

        alphaSpoken = alpha.split("").map(letter=>{
            return (typeof REVERSE_NATO !== "undefined" && REVERSE_NATO[letter])
                ? REVERSE_NATO[letter]
                : letter;
        }).join(" ");

    }

    const digitsSpoken = digits.split("").map(d => DIGIT_WORDS[d] || d).join(" ");

    return alphaSpoken + " " + digitsSpoken;

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

// Decode NATO phonetic words in a transcript into letters,
// leaving everything else untouched (words -> letters, spaces
// collapsed) - improves matching "golf foxtrot alpha one zero
// three" against callsign "GFA103".
function phoneticDecode(text){

    const words = text.toLowerCase().split(/\s+/);

    return words.map(w => {

        if(typeof NATO_ALPHABET !== "undefined" && NATO_ALPHABET[w]){
            return NATO_ALPHABET[w];
        }

        if(typeof WORD_TO_DIGIT !== "undefined" && WORD_TO_DIGIT[w] !== undefined){
            return WORD_TO_DIGIT[w];
        }

        return w;

    }).join("");

}

function findAircraftBySpokenCallsign(text){

    const activeList = [
        ...(typeof aircraft !== "undefined" ? aircraft : []),
        ...(typeof departures !== "undefined" ? departures : [])
    ].filter(ac => ac.active);

    // Try both the raw transcript and a phonetically-decoded
    // version, since speech recognition sometimes returns
    // formed callsigns ("GFA103") and sometimes spells them out
    // ("golf foxtrot alpha one zero three").
    const rawNormalized = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const phoneticNormalized = phoneticDecode(text).toUpperCase();

    let best = null;
    let bestLen = 0;

    activeList.forEach(ac=>{

        const cs = ac.callsign.toUpperCase().replace(/[^A-Z0-9]/g, "");

        // Also check the aircraft's real RT callsign form
        // (e.g. controller says "IFLY 121" for IGO121)
        const rtNormalized = (typeof spokenCallsign === "function")
            ? spokenCallsign(ac.callsign).toUpperCase().replace(/[^A-Z0-9]/g, "")
            : "";

        const hit =
            rawNormalized.includes(cs) ||
            phoneticNormalized.includes(cs) ||
            (rtNormalized && rawNormalized.includes(rtNormalized)) ||
            (rtNormalized && phoneticNormalized.includes(rtNormalized));

        if(hit && cs.length > bestLen){
            best = ac;
            bestLen = cs.length;
        }

    });

    return best;

}

// ======================================
// Robust digit-sequence extraction.
// Scans forward from a phrase match and
// concatenates EVERY consecutive numeric
// token (whether the recognizer gave us a
// formed numeral like "170" or separate
// spoken digits "one seven zero") - this
// is what fixes "170" being truncated to
// "17".
// ======================================

function extractNumberAfter(text, matchIndex, matchedPhraseLength){

    const after = text.slice(matchIndex + matchedPhraseLength);
    const words = after.trim().split(/\s+/);

    let digits = "";

    for(let i = 0; i < words.length; i++){

        const w = words[i].replace(/[^a-z0-9]/g, "");

        if(/^\d+$/.test(w)){
            digits += w;
            continue;
        }

        if(typeof WORD_TO_DIGIT !== "undefined" && WORD_TO_DIGIT[w] !== undefined){
            digits += WORD_TO_DIGIT[w];
            continue;
        }

        // "hundred"/"thousand" from a misheard/rounded number -
        // skip rather than abort, in case a stray word slips in
        if(w === "hundred" || w === "thousand" || w === ""){
            continue;
        }

        break;   // first non-numeric word ends the number

    }

    return digits.length ? parseInt(digits, 10) : null;

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
        panPan: false,
        reportLevel: false,
        reportHeading: false,
        reportSpeed: false,
        reportPosition: false
    };

    // ---- Report/query commands (check first - these don't
    // change anything, just ask the pilot to state a value) ----

    if(findPhrase(text, PHRASES.reportLevel))    cmd.reportLevel = true;
    if(findPhrase(text, PHRASES.reportHeading))  cmd.reportHeading = true;
    if(findPhrase(text, PHRASES.reportSpeed))    cmd.reportSpeed = true;
    if(findPhrase(text, PHRASES.reportPosition)) cmd.reportPosition = true;

    if(cmd.reportLevel || cmd.reportHeading || cmd.reportSpeed || cmd.reportPosition){
        return cmd;   // report commands are standalone
    }

    // ---- Heading ----

    let hdgHit = findPhrase(text, PHRASES.turnLeft);
    if(hdgHit){
        cmd.turnDirection = "LEFT";
    }
    else{
        hdgHit = findPhrase(text, PHRASES.turnRight);
        if(hdgHit) cmd.turnDirection = "RIGHT";
        else{
            hdgHit = findPhrase(text, PHRASES.fly);
            if(hdgHit) cmd.turnDirection = "SHORTEST";
        }
    }

    if(hdgHit){

        const num = extractNumberAfter(text, hdgHit.index, hdgHit.phrase.length);

        if(num !== null){
            cmd.heading = num % 360;
        }

    }

    // ---- Level (climb/descend/maintain, FL or feet) ----

    let levelHit = findPhrase(text, PHRASES.climb);
    if(levelHit) cmd.levelAction = "climb";
    else{
        levelHit = findPhrase(text, PHRASES.descend);
        if(levelHit) cmd.levelAction = "descend";
        else{
            levelHit = findPhrase(text, PHRASES.maintain);
        }
    }

    if(levelHit){

        let num = extractNumberAfter(text, levelHit.index, levelHit.phrase.length);

        if(num !== null){

            // If they said e.g. "5000 feet" that's feet, not FL
            const feetHit = text.indexOf("feet");
            const flHit = text.indexOf("flight level");

            if(feetHit !== -1 && (flHit === -1 || feetHit < flHit + 20)){
                num = Math.round(num / 100);
            }

            cmd.level = num;

        }

    }

    // ---- Speed ----

    const spdHit = findPhrase(text, PHRASES.speed);
    if(spdHit){

        const num = extractNumberAfter(text, spdHit.index, spdHit.phrase.length);
        if(num !== null) cmd.speed = num;

    }

    // ---- Squawk ----

    const sqHit = findPhrase(text, PHRASES.squawk);
    if(sqHit){

        const num = extractNumberAfter(text, sqHit.index, sqHit.phrase.length);
        if(num !== null) cmd.squawk = String(num).padStart(4,"0");

    }

    // ---- Direct to fix ----

    const dctHit = findPhrase(text, PHRASES.directTo);
    if(dctHit){

        const after = text.slice(dctHit.index + dctHit.phrase.length).trim();
        const spoken = after.split(/\s+/)[0] ? after.split(/\s+/)[0].toUpperCase() : "";

        const fixNames = (typeof FIXES !== "undefined") ? FIXES.map(f => f.name) : [];
        const match = fixNames.find(f => f === spoken || f.startsWith(spoken));

        if(match) cmd.directToFix = match;

    }

    // ---- Intercept / vectors ----

    if(findPhrase(text, PHRASES.intercept)) cmd.intercept = true;

    // ---- Go-around ----

    if(findPhrase(text, PHRASES.goAround)) cmd.discontinue = true;

    // ---- Emergency ----

    if(findPhrase(text, PHRASES.mayday)) cmd.mayday = true;
    if(findPhrase(text, PHRASES.panPan)) cmd.panPan = true;

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

    const readback = readbackParts.join(", ") + ", " + spokenCallsign(ac.callsign);

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
        const text = "Mayday, Mayday, Mayday, " + spokenCallsign(ac.callsign);
        logTransmission("PILOT", ac.callsign, text);
        speak(text);
        return;
    }

    if(cmd.panPan){
        const text = "Pan Pan, Pan Pan, Pan Pan, " + spokenCallsign(ac.callsign);
        logTransmission("PILOT", ac.callsign, text);
        speak(text);
        return;
    }

    // Report/query commands - state what's actually happening,
    // don't change anything
    if(cmd.reportLevel){
        const text = spokenCallsign(ac.callsign) + ", level " + spokenDigits(Math.round(ac.level)) +
            (Math.round(ac.level) !== Math.round(ac.targetLevel)
                ? (ac.level > ac.targetLevel ? ", descending" : ", climbing") +
                  " Flight Level " + spokenDigits(Math.round(ac.targetLevel))
                : "");
        logTransmission("PILOT", ac.callsign, text);
        speak(text);
        return;
    }

    if(cmd.reportHeading){
        const text = spokenCallsign(ac.callsign) + ", heading " + spokenDigits(Math.round(ac.heading));
        logTransmission("PILOT", ac.callsign, text);
        speak(text);
        return;
    }

    if(cmd.reportSpeed){
        const text = spokenCallsign(ac.callsign) + ", speed " + spokenDigits(Math.round(ac.speed));
        logTransmission("PILOT", ac.callsign, text);
        speak(text);
        return;
    }

    if(cmd.reportPosition){
        const dx = ac.x - CCB.x, dy = ac.y - CCB.y;
        const distNM = Math.round(Math.sqrt(dx*dx+dy*dy) / PIXELS_PER_NM);
        const text = spokenCallsign(ac.callsign) + ", " + distNM + " miles from CCB";
        logTransmission("PILOT", ac.callsign, text);
        speak(text);
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

    const text = "Mayday, Mayday, Mayday, " + spokenCallsign(selectedAircraft.callsign);
    logTransmission("PILOT", selectedAircraft.callsign, text);
    speak(text);

}

function announcePanPan(){

    if(selectedAircraft == null){
        alert("Select an aircraft first.");
        return;
    }

    const text = "Pan Pan, Pan Pan, Pan Pan, " + spokenCallsign(selectedAircraft.callsign);
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

            const text = spokenCallsign(ac.callsign) + ", level " + spokenDigits(Math.round(ac.level)) +
                (ac.squawk ? ", squawk " + spokenDigits(parseInt(ac.squawk)) : "");

            logTransmission("PILOT", ac.callsign, text);
            speak(text);

        }

        // Passing/reaching assigned level
        if(Math.round(ac.level) === Math.round(ac.targetLevel) &&
           ac.verticalSpeed === 0 &&
           ac.radioLastLevelCalled !== Math.round(ac.targetLevel)){

            ac.radioLastLevelCalled = Math.round(ac.targetLevel);

            const text = spokenCallsign(ac.callsign) + ", level " + spokenDigits(Math.round(ac.level));

            logTransmission("PILOT", ac.callsign, text);
            speak(text);

        }

        // Established on localiser
        if(ac.established && !ac.radioEstablishedCalled){

            ac.radioEstablishedCalled = true;

            const text = spokenCallsign(ac.callsign) + ", established localiser";

            logTransmission("PILOT", ac.callsign, text);
            speak(text);

        }

        if(!ac.established){
            ac.radioEstablishedCalled = false;
        }

        // Established on the approach / glidepath (final)
        if(ac.approach && !ac.radioApproachCalled){

            ac.radioApproachCalled = true;

            const text = spokenCallsign(ac.callsign) + ", established, final approach";

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
