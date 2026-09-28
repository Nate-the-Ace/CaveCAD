// CsLinetypeStore.js -- where Linetype Maker's linetypes live.
//
// A caver's own linetypes live in ONE .lin file beside their caves,
// ~/Documents/Cave/linetypes/CaveCustomLinetypes.lin: that folder syncs
// and is backed up, and no release touches it. NOT the template -- the
// Symbol Palette kept customs in the template until publish.sh replaced
// it and took a real symbol with it (2026-09-06).
//
// A drawing's linetypes are RLinetype objects in its document; this file
// is the only code that writes them, so the one trap below is handled once.

var CsLinetypeStore = {};

CsLinetypeStore.CUSTOM_NAME = "CaveCustomLinetypes.lin";

/** Tests point the library at a scratch file. */
CsLinetypeStore.pathOverride = null;

CsLinetypeStore.BUILT_IN = ["BYLAYER", "BYBLOCK", "CONTINUOUS"];

CsLinetypeStore.customPath = function() {
    if (CsLinetypeStore.pathOverride !== null) {
        return CsLinetypeStore.pathOverride;
    }
    try {
        var setting = RSettings.getStringValue("CaveSurvey/LinetypeLibrary", "");
        if (setting !== "") {
            return setting;
        }
    } catch (eSet) {
    }
    return QDir.homePath() + "/Documents/Cave/linetypes/" + CsLinetypeStore.CUSTOM_NAME;
};

CsLinetypeStore.readText = function(path) {
    var f = new QFile(path);
    if (!f.exists() || !f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        return null;
    }
    var stream = new QTextStream(f);
    try {
        stream.setEncoding(QStringConverter.Utf8);
    } catch (eEnc) {
        // an older bridge reads in the locale's codec, UTF-8 everywhere
    }
    var text = String(stream.readAll());
    f.close();
    return text;
};

/** \return null on success, else a sentence saying what failed. */
CsLinetypeStore.writeText = function(path, text) {
    try {
        new QDir().mkpath(new QFileInfo(path).absolutePath());
        var f = new QFile(path);
        if (!f.open(QIODevice.WriteOnly | QIODevice.Truncate | QIODevice.Text)) {
            return "Could not write " + path + ".";
        }
        var stream = new QTextStream(f);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
        }
        stream.writeString(text);
        stream.flush();
        f.close();
        return null;
    } catch (e) {
        return "Could not write " + path + " (" + e + ").";
    }
};

/** \return { linetypes, errors } -- empty when the file does not exist yet. */
CsLinetypeStore.loadCustom = function() {
    var text = CsLinetypeStore.readText(CsLinetypeStore.customPath());
    if (text === null) {
        return { linetypes: [], errors: [] };
    }
    return CsLinetype.parseLin(text);
};

CsLinetypeStore.indexOf = function(list, name) {
    var want = String(name).toUpperCase();
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].name).toUpperCase() === want) {
            return i;
        }
    }
    return -1;
};

/** Adds or replaces (by name, any case). \return null or an error. */
CsLinetypeStore.saveCustom = function(model) {
    var problems = CsLinetype.validate(model);
    if (problems.length > 0) {
        return problems.join(" ");
    }
    var list = CsLinetypeStore.loadCustom().linetypes;
    var at = CsLinetypeStore.indexOf(list, model.name);
    if (at >= 0) {
        list[at] = model;
    } else {
        list.push(model);
    }
    return CsLinetypeStore.writeText(CsLinetypeStore.customPath(),
        CsLinetype.writeLin(list));
};

CsLinetypeStore.removeCustom = function(name) {
    var list = CsLinetypeStore.loadCustom().linetypes;
    var at = CsLinetypeStore.indexOf(list, name);
    if (at < 0) {
        return "No linetype called " + name + " in your library.";
    }
    list.splice(at, 1);
    return CsLinetypeStore.writeText(CsLinetypeStore.customPath(),
        CsLinetype.writeLin(list));
};

/**
 * Whether the drawing has a linetype of that name (any case).
 *
 * NOT isNull(doc.queryLinetype(name)): for a name the drawing does not
 * have, queryLinetype hands script a live-looking RLinetype wrapper whose
 * getId() answers undefined -- probed 2026-09-28. Treating that as "found"
 * modified a phantom and the new linetype never landed.
 */
CsLinetypeStore.hasLinetype = function(doc, name) {
    var want = String(name).toUpperCase();
    var names = doc.getLinetypeNames();
    for (var i = 0; i < names.length; i++) {
        if (String(names[i]).toUpperCase() === want) {
            return true;
        }
    }
    return false;
};

/** Every linetype in a drawing as a model, built-ins left out. */
CsLinetypeStore.fromDocument = function(doc) {
    var out = [];
    var names = doc.getLinetypeNames();
    for (var i = 0; i < names.length; i++) {
        var name = String(names[i]);
        if (CsLinetypeStore.BUILT_IN.indexOf(name.toUpperCase()) >= 0) {
            continue;
        }
        var lt = doc.queryLinetype(name);
        var r = CsLinetype.fromPattern(String(lt.getPatternString()));
        if (r.errors.length > 0 || r.segments.length === 0) {
            continue;
        }
        out.push({ name: name, description: String(lt.getDescription()),
                   segments: r.segments });
    }
    return out;
};

/**
 * Adds the linetype to the drawing, or replaces the pattern of the one
 * already there under that name.
 *
 * RAddObjectOperation's second argument is FALSE on purpose: true (the
 * default) stamps the current attributes over the object -- the trap the
 * Symbol Palette found moving blocks between documents.
 *
 * \return null on success, else a sentence.
 */
CsLinetypeStore.applyToDocument = function(doc, di, model) {
    var problems = CsLinetype.validate(model);
    if (problems.length > 0) {
        return problems.join(" ");
    }
    var pat = new RLinetypePattern(doc.isMetric(), model.name, model.description || "");
    if (!pat.setPatternString(CsLinetype.toPattern(model))) {
        return "CaveCAD refused the pattern " + CsLinetype.toPattern(model) + ".";
    }
    var lt;
    if (CsLinetypeStore.hasLinetype(doc, model.name)) {
        lt = doc.queryLinetype(model.name);
        lt.setPattern(pat);
    } else {
        lt = new RLinetype(doc, pat);
    }
    di.applyOperation(new RAddObjectOperation(lt, false));

    if (!CsLinetypeStore.hasLinetype(doc, model.name)) {
        return "The linetype did not land in the drawing.";
    }
    return null;
};

/**
 * The template pour's step: every custom linetype into a new drawing.
 * \return the names that could not be added.
 */
CsLinetypeStore.applyAll = function(doc, di) {
    var list = CsLinetypeStore.loadCustom().linetypes;
    var failed = [];
    for (var i = 0; i < list.length; i++) {
        if (CsLinetypeStore.applyToDocument(doc, di, list[i]) !== null) {
            failed.push(list[i].name);
        }
    }
    return failed;
};
