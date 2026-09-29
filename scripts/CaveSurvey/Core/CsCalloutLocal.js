// CsCalloutLocal.js -- the callout card's roster and contacts.
//
// Part of the Cave Survey Core library. Names, medical notes and phone
// numbers are personal data: they live in per-user QCAD settings on this
// machine and are NEVER written to stations.json or the cave folder
// (Drive syncs that). The codec is pure; load/save touch RSettings.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

var CsCalloutLocal = {};

CsCalloutLocal.KEY_ROSTER = "CaveSurvey/Callout/Roster";
CsCalloutLocal.KEY_CONTACTS = "CaveSurvey/Callout/Contacts";
CsCalloutLocal.DEFAULT_BUFFER_MIN = 120;

var csLocalStr = function(v) {
    return (v === undefined || v === null) ? "" : String(v);
};

CsCalloutLocal.serializeRoster = function(list) {
    return JSON.stringify(list);
};

/** \return [{name, role, squeeze (number|null), medical, emergency}] */
CsCalloutLocal.parseRoster = function(text) {
    var out = [];
    var list;
    try {
        list = JSON.parse(String(text));
    } catch (e) {
        return out;
    }
    if (Object.prototype.toString.call(list) !== "[object Array]") { return out; }
    for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p === null || typeof p !== "object") { continue; }
        var sq = parseFloat(csLocalStr(p.squeeze));
        var row = { name: csLocalStr(p.name), role: csLocalStr(p.role),
            squeeze: (isFinite(sq) && sq > 0) ? sq : null,
            medical: csLocalStr(p.medical), emergency: csLocalStr(p.emergency) };
        if (row.name === "" && row.role === "" && row.squeeze === null &&
                row.medical === "" && row.emergency === "") { continue; }
        out.push(row);
    }
    return out;
};

CsCalloutLocal.serializeContacts = function(c) {
    return JSON.stringify(c);
};

/** \return {topName, topPhone, escalation, bufferMin} */
CsCalloutLocal.parseContacts = function(text) {
    var c = { topName: "", topPhone: "", escalation: "",
        bufferMin: CsCalloutLocal.DEFAULT_BUFFER_MIN };
    try {
        var data = JSON.parse(String(text));
        c.topName = csLocalStr(data.topName);
        c.topPhone = csLocalStr(data.topPhone);
        c.escalation = csLocalStr(data.escalation);
        var b = parseFloat(csLocalStr(data.bufferMin));
        if (isFinite(b) && b > 0) { c.bufferMin = b; }
    } catch (e) {
    }
    return c;
};

var csLocalRead = function(key) {
    try {
        return String(RSettings.getStringValue(key, ""));
    } catch (e) {
        return "";
    }
};

var csLocalWrite = function(key, text) {
    try {
        RSettings.setValue(key, text);
        return true;
    } catch (e) {
        return false;
    }
};

CsCalloutLocal.loadRoster = function() {
    return CsCalloutLocal.parseRoster(csLocalRead(CsCalloutLocal.KEY_ROSTER));
};
CsCalloutLocal.saveRoster = function(list) {
    return csLocalWrite(CsCalloutLocal.KEY_ROSTER, CsCalloutLocal.serializeRoster(list));
};
CsCalloutLocal.loadContacts = function() {
    return CsCalloutLocal.parseContacts(csLocalRead(CsCalloutLocal.KEY_CONTACTS));
};
CsCalloutLocal.saveContacts = function(c) {
    return csLocalWrite(CsCalloutLocal.KEY_CONTACTS, CsCalloutLocal.serializeContacts(c));
};
