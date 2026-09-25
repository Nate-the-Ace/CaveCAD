// qstr_shim.js -- qsTr() and String.prototype.arg for suites run under node.
//
// The add-on says everything through qsTr("... %1 ...").arg(x) so it can
// be translated. CaveCAD's engine provides both; node provides neither, so
// the node-run suites eval this first. Inside CaveCAD every definition
// below is skipped.
//
// .arg follows the engine exactly, because tests compare the English
// text: it replaces the LOWEST-numbered %N left in the string, formats a
// number the way QString::arg(double) does (%g, six significant digits:
// 0.1 + 0.2 -> "0.3", 12345678901 -> "1.23457e+10"), and turns a boolean
// into "1" or "0". A surplus .arg() leaves the string as it was.

if (typeof qsTr === "undefined") {
    qsTr = function(text) { return text; };
}
if (typeof qsTranslate === "undefined") {
    qsTranslate = function(context, text) { return text; };
}
if (typeof String.prototype.arg === "undefined") {
    (function() {
        var formatG = function(v) {
            if (!isFinite(v)) {
                return String(v);
            }
            // the engine hands a whole number that fits an int to
            // QString::arg(int), which prints every digit
            if (v === Math.round(v) && Math.abs(v) < 2147483648) {
                return String(v);
            }
            if (v === 0) {
                return "0";
            }
            // %g: exponent form below 1e-4 or from 1e6 up, as C does
            var e10 = Math.floor(Math.log(Math.abs(v)) / Math.LN10);
            var s = (e10 < -4 || e10 >= 6) ? v.toExponential(5) :
                v.toPrecision(6);
            if (s.indexOf("e") >= 0) {
                // Qt drops the mantissa's trailing zeros and writes a
                // two-digit exponent: 1.23457e+10, -1.2345e-05
                var parts = s.split("e");
                var mant = parts[0].indexOf(".") >= 0 ?
                    parts[0].replace(/0+$/, "").replace(/\.$/, "") : parts[0];
                var exp = parts[1];
                var sign = exp.charAt(0);
                var digits = exp.substring(1);
                if (digits.length < 2) {
                    digits = "0" + digits;
                }
                return mant + "e" + sign + digits;
            }
            return s.indexOf(".") >= 0 ?
                s.replace(/0+$/, "").replace(/\.$/, "") : s;
        };
        Object.defineProperty(String.prototype, "arg", {
            enumerable: false,
            value: function(value) {
                var text = String(this);
                var lowest = null;
                var re = /%(\d{1,2})/g;
                var m;
                while ((m = re.exec(text)) !== null) {
                    var n = parseInt(m[1], 10);
                    if (lowest === null || n < lowest) {
                        lowest = n;
                    }
                }
                if (lowest === null) {
                    return text;
                }
                var shown = typeof value === "number" ? formatG(value) :
                    typeof value === "boolean" ? (value ? "1" : "0") :
                    String(value);
                return text.replace(new RegExp("%" + lowest + "(?!\\d)", "g"),
                    function() { return shown; });
            }
        });
    })();
}
