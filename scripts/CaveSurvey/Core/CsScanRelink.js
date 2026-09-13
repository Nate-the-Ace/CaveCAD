// CsScanRelink.js -- putting a scan's file reference back.
//
// Part of the Cave Survey Core library. QCAD context throughout: every
// function here takes a real document.
//
// WHAT BREAKS. A placed scan is an IMAGE entity pointing at a file, and
// the pointer lives in the DXF's IMAGEDEF. That path can be lost -- a
// round trip through another program, a cave folder that moved, a Drive
// path that changed -- and when it goes the image is still there, still
// the right size and still in the right place, pointing at nothing.
// Truitt Cave had all forty-seven of its images in exactly that state:
// every IMAGEDEF carrying an empty path, nothing drawn in the 2D view,
// and no error anywhere to say so.
//
// WHY IT IS RECOVERABLE. This suite tags every scan it places with the
// page it came from -- SketchScan for plan and profile, SectionScan for
// a section's own -- relative to the cave's scans folder. That tag is
// XDATA on the entity and survives what the IMAGEDEF does not. So the
// drawing still knows which file each image WAS, even when it no longer
// knows where to find it.
//
// IT LASTS FOR THE SESSION, NOT THROUGH A SAVE. Measured on Truitt:
// relinked 46 of 47, saved, reloaded -- 0 of 47. CaveCAD's DXF exporter
// writes an IMAGEDEF with an EMPTY path for these images however the
// entity is repaired, and drops a script-created image entity
// altogether (93 images in memory came back as 47). Replacing the
// entities instead was tried and is WORSE: the replacements do not
// export either, so the drawing loses the images it had.
//
// So this makes the scans visible again -- in the 2D view, and to the
// 3D panel's drape -- for as long as the drawing stays open, and has to
// be run again next time. That is worth having and is not a fix. The
// fix is in the exporter, and belongs in the fork.
//
// WHAT IT WILL NOT DO. It never guesses. An image with no tag is left
// alone, and a tag naming a file that is not on disk is REPORTED rather
// than quietly repointed at something nearby: an image silently showing
// the wrong page is worse than one showing nothing, because nothing is
// obviously nothing.

var CsScanRelink = {};

/** The XDATA keys a scan's own page is recorded under. Plan and profile
 *  scans use the first; a section's scan uses the second. */
CsScanRelink.TAGS = ["SketchScan", "SectionScan"];

/**
 * Re-points every image whose file reference has been lost.
 *
 * \return {relinked, missing: [name], untagged, alreadyLinked}
 */
CsScanRelink.run = function(doc, di) {
    var out = { relinked: 0, missing: [], untagged: 0, alreadyLinked: 0 };
    if (isNull(doc) || isNull(di)) {
        return out;
    }
    var scans = CsCave.scansDir(doc.getFileName());
    if (scans === null) {
        // Not saved in a cave folder, so a relative tag has nothing to
        // be relative TO.
        return out;
    }

    var ids;
    try {
        ids = doc.queryAllEntities(false, true);
    } catch (e) {
        return out;
    }

    var op = new RModifyObjectsOperation();
    var any = false;

    for (var i = 0; i < ids.length; i++) {
        try {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || e.getType() !== RS.EntityImage) {
                continue;
            }
            var current = String(
                e.getProperty(RImageEntity.PropertyFileName)[0]);
            if (current !== "") {
                out.alreadyLinked++;
                continue;
            }
            var stored = "";
            for (var t = 0; t < CsScanRelink.TAGS.length; t++) {
                var got = CsTags.get(e, CsScanRelink.TAGS[t]);
                if (typeof got === "string" && got !== "") {
                    stored = got;
                    break;
                }
            }
            if (stored === "") {
                // No record of what it was. Guessing from position or
                // from what else is in the folder would be inventing a
                // provenance the drawing never had.
                out.untagged++;
                continue;
            }
            var abs = CsCave.isAbsolutePath(stored)
                ? stored : CsCave.resolveUnderScans(scans, stored);
            if (abs === null || !(new QFileInfo(abs)).exists()) {
                out.missing.push(stored);
                continue;
            }
            e.setProperty(RImageEntity.PropertyFileName, abs);
            op.addObject(e, false);
            any = true;
            out.relinked++;
        } catch (eOne) {
            // One unreadable image must not stop the rest being fixed.
            continue;
        }
    }

    if (any) {
        di.applyOperation(op);
    }
    return out;
};

/** One line for a report. */
CsScanRelink.summary = function(r) {
    if (r.relinked === 0 && r.missing.length === 0 && r.untagged === 0) {
        return qsTr("Scan images: all %1 still point at their files.")
            .arg(r.alreadyLinked);
    }
    // SAYS IT DOES NOT LAST. A repair a caver believes is permanent,
    // and is not, costs them the next session's confusion as well as
    // this one's.
    var parts = [];
    if (r.relinked > 0) {
        parts.push(qsTr("%1 relinked").arg(r.relinked));
    }
    if (r.missing.length > 0) {
        // NAMED, not counted. "3 missing" sends a caver hunting; the
        // names say which pages to go and find.
        parts.push(qsTr("%1 still missing (%2)")
            .arg(r.missing.length).arg(r.missing.join(", ")));
    }
    if (r.untagged > 0) {
        parts.push(qsTr("%1 with no record of their page").arg(r.untagged));
    }
    var text = qsTr("Scan images: ") + parts.join(", ") + ".";
    if (r.relinked > 0) {
        text += qsTr(" This lasts until the drawing is closed -- saving "
            + "does not keep it, so run Repair Drawing again next time.");
    }
    return text;
};
