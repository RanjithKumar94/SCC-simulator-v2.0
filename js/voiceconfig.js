// ======================================
// voiceConfig.js
// Edit THIS file to teach the voice
// system new phrases, callsign
// pronunciations, or reply wording -
// you shouldn't need to touch voice.js
// itself for most tuning.
// ======================================

// ----------------------------------------
// Spoken digits -> numeral. Aviation always
// speaks numbers digit-by-digit ("one seven
// zero", not "one hundred seventy").
// ----------------------------------------
const WORD_TO_DIGIT = {
    "zero":"0", "oh":"0", "o":"0",
    "one":"1", "won":"1",
    "two":"2", "to":"2", "too":"2",
    "three":"3", "tree":"3",
    "four":"4", "for":"4",
    "five":"5", "fife":"5",
    "six":"6",
    "seven":"7",
    "eight":"8", "ate":"8",
    "nine":"9", "niner":"9"
};

// ----------------------------------------
// NATO phonetic alphabet -> letter, used to
// decode spoken callsigns like "golf foxtrot
// alpha one zero three" -> "GFA103"
// ----------------------------------------
const NATO_ALPHABET = {
    "alpha":"A", "alfa":"A",
    "bravo":"B",
    "charlie":"C",
    "delta":"D",
    "echo":"E",
    "foxtrot":"F",
    "golf":"G",
    "hotel":"H",
    "india":"I",
    "juliet":"J", "juliett":"J",
    "kilo":"K",
    "lima":"L",
    "mike":"M",
    "november":"N",
    "oscar":"O",
    "papa":"P",
    "quebec":"Q",
    "romeo":"R",
    "sierra":"S",
    "tango":"T",
    "uniform":"U",
    "victor":"V",
    "whiskey":"W",
    "xray":"X", "x-ray":"X",
    "yankee":"Y",
    "zulu":"Z"
};

// ----------------------------------------
// Command phraseology synonyms. Add more
// trigger phrases to any list to make the
// parser recognise more ways of saying the
// same instruction.
// ----------------------------------------
const PHRASES = {

    turnLeft: ["turn left", "left turn", "left heading"],
    turnRight: ["turn right", "right turn", "right heading"],
    fly: ["fly heading", "heading", "come to heading"],

    climb: ["climb and maintain", "climb to", "climb"],
    descend: ["descend and maintain", "descend to", "descend"],
    maintain: ["maintain flight level", "maintain"],

    speed: ["speed", "reduce speed to", "increase speed to", "reduce speed", "increase speed"],
    squawk: ["squawk"],

    directTo: ["direct", "proceed direct", "cleared direct"],
    intercept: ["intercept", "localiser", "localizer", "vectors", "vector", "ils"],

    goAround: ["go around", "going around", "discontinue approach", "discontinue", "missed approach"],

    mayday: ["mayday"],
    panPan: ["pan pan", "pan-pan"],

    // Report/query commands - pilot reports current state,
    // nothing is changed on the aircraft
    reportLevel: ["report level", "say level", "report altitude", "say altitude", "confirm level", "confirm altitude"],
    reportHeading: ["report heading", "say heading", "confirm heading"],
    reportSpeed: ["report speed", "say speed", "confirm speed"],
    reportPosition: ["report position", "say position", "confirm position"]

};

// Helper: does the text contain any phrase from a list?
// Returns the matched phrase's index in the text, or -1.
function findPhrase(text, phraseList){

    for(let i = 0; i < phraseList.length; i++){
        const idx = text.indexOf(phraseList[i]);
        if(idx !== -1) return {index: idx, phrase: phraseList[i]};
    }

    return null;

}
