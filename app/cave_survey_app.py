"""
cave_survey_app.py

A small GUI app for entering cave survey shot data (station name, azimuth,
distance, inclination, LRUD) in a layout modeled on a paper survey sheet,
with a live preview of the plotted alignment, and a "Generate DXF" button
that draws the result into a copy of NSS_Cave_Template_PLAN.dxf.

Requires: Python 3, tkinter (usually bundled with Python), matplotlib, ezdxf.
  pip install matplotlib ezdxf

Run:
  python3 cave_survey_app.py

By default this looks for NSS_Cave_Template_PLAN.dxf in ../templates/ (and,
for a loose copy of the app, in the same folder as
this script. If it isn't found, you'll be asked to locate it once.
"""

import os
import sys
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

import matplotlib
matplotlib.use("TkAgg")
from matplotlib.figure import Figure
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

import survey_core as sc
import format_io as fio

FIELD_ORDER = ["from_name", "to_name", "distance", "azimuth", "inclination",
               "left", "right", "up", "down", "notes"]
FIELD_LABELS = {
    "from_name": "From", "to_name": "To", "distance": "Dist", "azimuth": "Azimuth",
    "inclination": "Inc", "left": "L", "right": "R", "up": "U", "down": "D",
    "notes": "Notes",
}
FIELD_WIDTHS = {
    "from_name": 7, "to_name": 7, "distance": 7, "azimuth": 8, "inclination": 6,
    "left": 5, "right": 5, "up": 5, "down": 5, "notes": 18,
}

TEMPLATE_FILENAME = "NSS_Cave_Template_PLAN.dxf"


class ShotRow:
    """One row of Entry widgets inside the shot table."""

    def __init__(self, parent, on_change, on_delete):
        self.frame = ttk.Frame(parent)
        self.entries = {}
        self.on_change = on_change
        self.on_delete = on_delete

        for field in FIELD_ORDER:
            entry = ttk.Entry(self.frame, width=FIELD_WIDTHS[field])
            entry.pack(side="left", padx=2)
            entry.bind("<KeyRelease>", self._changed)
            self.entries[field] = entry

        delete_btn = ttk.Button(self.frame, text="x", width=2, command=self._delete)
        delete_btn.pack(side="left", padx=(4, 0))

    def _changed(self, event=None):
        self.on_change()

    def _delete(self):
        self.on_delete(self)

    def get_data(self):
        return {field: self.entries[field].get() for field in FIELD_ORDER}

    def set_from_name(self, value):
        self.entries["from_name"].delete(0, tk.END)
        self.entries["from_name"].insert(0, value)

    def set_data(self, data):
        for field in FIELD_ORDER:
            entry = self.entries[field]
            entry.delete(0, tk.END)
            entry.insert(0, data.get(field, ""))

    def flag_error(self, has_error):
        for field in ("distance", "azimuth"):
            entry = self.entries[field]
            entry.configure(foreground="#a32d2d" if has_error else "")

    def destroy(self):
        self.frame.destroy()


class CaveSurveyApp:
    def __init__(self, root, template_path):
        self.root = root
        self.template_path = template_path
        self.rows = []
        self._refresh_job = None

        root.title("Cave Survey Data Entry")

        header = ttk.Frame(root, padding=10)
        header.pack(fill="x")

        self.header_vars = {}
        header_fields = [
            ("cave_name", "Cave name"), ("survey_designation", "Survey designation"),
            ("date", "Date"), ("declination", "Declination"),
            ("surveyors", "Surveyors"), ("instruments", "Instruments / units"),
        ]
        for i, (key, label) in enumerate(header_fields):
            row, col = divmod(i, 3)
            frame = ttk.Frame(header)
            frame.grid(row=row, column=col, padx=6, pady=3, sticky="ew")
            ttk.Label(frame, text=label, font=("", 9)).pack(anchor="w")
            var = tk.StringVar()
            ttk.Entry(frame, textvariable=var, width=24).pack(fill="x")
            self.header_vars[key] = var
        for c in range(3):
            header.columnconfigure(c, weight=1)

        start_frame = ttk.Frame(root, padding=(10, 0))
        start_frame.pack(fill="x")
        ttk.Label(start_frame, text="Starting station:").pack(side="left")
        self.start_name_var = tk.StringVar(value="A1")
        ttk.Entry(start_frame, textvariable=self.start_name_var, width=8).pack(side="left", padx=4)
        ttk.Label(start_frame, text="X:").pack(side="left", padx=(8, 0))
        self.start_x_var = tk.StringVar(value="0")
        ttk.Entry(start_frame, textvariable=self.start_x_var, width=8).pack(side="left", padx=4)
        ttk.Label(start_frame, text="Y:").pack(side="left", padx=(8, 0))
        self.start_y_var = tk.StringVar(value="0")
        ttk.Entry(start_frame, textvariable=self.start_y_var, width=8).pack(side="left", padx=4)
        for var in (self.start_name_var, self.start_x_var, self.start_y_var):
            var.trace_add("write", lambda *a: self.schedule_refresh())

        main = ttk.PanedWindow(root, orient="horizontal")
        main.pack(fill="both", expand=True, padx=10, pady=10)

        left_panel = ttk.Frame(main)
        main.add(left_panel, weight=1)

        table_header = ttk.Frame(left_panel)
        table_header.pack(fill="x")
        for field in FIELD_ORDER:
            ttk.Label(table_header, text=FIELD_LABELS[field], width=FIELD_WIDTHS[field],
                      font=("", 9, "bold")).pack(side="left", padx=2)

        rows_container = ttk.Frame(left_panel)
        rows_container.pack(fill="both", expand=True, pady=(2, 6))
        self.rows_container = rows_container

        button_row = ttk.Frame(left_panel)
        button_row.pack(fill="x")
        ttk.Button(button_row, text="+ Add shot row", command=self.add_row).pack(side="left")
        ttk.Button(button_row, text="Import...", command=self.import_file).pack(side="left", padx=(8, 0))
        ttk.Button(button_row, text="Export...", command=self.export_file).pack(side="left", padx=(4, 0))
        ttk.Button(button_row, text="Generate DXF", command=self.generate_dxf).pack(side="right")

        self.error_label = ttk.Label(left_panel, text="", foreground="#a32d2d", wraplength=420)
        self.error_label.pack(fill="x", pady=(6, 0))

        right_panel = ttk.Frame(main)
        main.add(right_panel, weight=1)

        self.figure = Figure(figsize=(5, 5), dpi=100)
        self.ax = self.figure.add_subplot(111)
        self.canvas = FigureCanvasTkAgg(self.figure, master=right_panel)
        self.canvas.get_tk_widget().pack(fill="both", expand=True)

        self.add_row()
        self.add_row()
        self.refresh_preview()

    def ask_format(self, title):
        """Small modal dialog with one button per format. Returns the chosen
        format name, or None if cancelled."""
        result = {"value": None}
        dialog = tk.Toplevel(self.root)
        dialog.title(title)
        dialog.transient(self.root)
        dialog.grab_set()
        ttk.Label(dialog, text=title, padding=10).pack()
        button_frame = ttk.Frame(dialog, padding=(10, 0, 10, 10))
        button_frame.pack()

        def choose(fmt):
            result["value"] = fmt
            dialog.destroy()

        for fmt in ("Walls", "Compass", "Survex"):
            ttk.Button(button_frame, text=fmt, width=12,
                       command=lambda f=fmt: choose(f)).pack(side="left", padx=4)
        ttk.Button(dialog, text="Cancel", command=dialog.destroy).pack(pady=(0, 10))

        dialog.wait_window()
        return result["value"]

    def clear_rows(self):
        for row in self.rows:
            row.destroy()
        self.rows = []

    def add_row_with_data(self, data):
        row = ShotRow(self.rows_container, self.schedule_refresh, self.delete_row)
        row.frame.pack(fill="x", pady=1)
        row.set_data(data)
        self.rows.append(row)

    def import_file(self):
        fmt = self.ask_format("Which format is this file?")
        if fmt is None:
            return

        path = filedialog.askopenfilename(
            title=f"Select {fmt} file",
            filetypes=fio.FILE_FILTERS[fmt],
        )
        if not path:
            return

        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                content = f.read()
            imported_rows, warnings = fio.PARSERS[fmt](content)
        except Exception as e:
            messagebox.showerror("Import", f"Failed to read file:\n\n{e}")
            return

        if not imported_rows:
            messagebox.showwarning("Import", "No shots were found in this file.")
            return

        has_existing_data = any(row.get_data().get("from_name") for row in self.rows)
        if has_existing_data:
            replace = messagebox.askyesnocancel(
                "Import",
                f"Found {len(imported_rows)} shot(s). Replace the current table, "
                "or append to it?\n\nYes = replace, No = append, Cancel = abort import."
            )
            if replace is None:
                return
            if replace:
                self.clear_rows()

        for data in imported_rows:
            self.add_row_with_data(data)
        self.add_row()  # trailing blank row for continued manual entry

        if imported_rows:
            self.start_name_var.set(imported_rows[0]["from_name"])

        self.schedule_refresh()

        summary = f"Imported {len(imported_rows)} shot(s) from {fmt}."
        if warnings:
            summary += "\n\nWarnings:\n" + "\n".join(warnings)
        messagebox.showinfo("Import", summary)

    def export_file(self):
        fmt = self.ask_format("Export as which format?")
        if fmt is None:
            return

        rows_data = [row.get_data() for row in self.rows]
        rows_data = [r for r in rows_data if r.get("from_name") and r.get("to_name")]
        if not rows_data:
            messagebox.showwarning("Export", "No complete shots to export yet.")
            return

        path = filedialog.asksaveasfilename(
            title=f"Save {fmt} file as",
            defaultextension=fio.EXTENSIONS[fmt],
            filetypes=fio.FILE_FILTERS[fmt],
        )
        if not path:
            return

        header_info = {k: v.get() for k, v in self.header_vars.items()}
        try:
            warnings = fio.WRITERS[fmt](rows_data, header_info, path) or []
        except Exception as e:
            messagebox.showerror("Export", f"Failed to write file:\n\n{e}")
            return

        message = f"Saved {len(rows_data)} shot(s) to:\n{path}"
        if warnings:
            # The file was written; these tell the surveyor what couldn't be
            # represented in this format, so it's a warning, not an error.
            message += "\n\nPlease note:\n\n" + "\n\n".join(warnings)
            messagebox.showwarning("Export", message)
        else:
            messagebox.showinfo("Export", message)


        row = ShotRow(self.rows_container, self.schedule_refresh, self.delete_row)
        row.frame.pack(fill="x", pady=1)
        if self.rows:
            last_to = self.rows[-1].entries["to_name"].get().strip()
            if last_to:
                row.set_from_name(last_to)
        self.rows.append(row)
        self.schedule_refresh()

    def delete_row(self, row):
        if len(self.rows) <= 1:
            return
        row.destroy()
        self.rows.remove(row)
        self.schedule_refresh()

    def schedule_refresh(self):
        if self._refresh_job is not None:
            self.root.after_cancel(self._refresh_job)
        self._refresh_job = self.root.after(250, self.refresh_preview)

    def get_start_point(self):
        name = self.start_name_var.get().strip() or "A1"
        try:
            x = float(self.start_x_var.get().strip() or "0")
        except ValueError:
            x = 0.0
        try:
            y = float(self.start_y_var.get().strip() or "0")
        except ValueError:
            y = 0.0
        return name, x, y

    def refresh_preview(self):
        self._refresh_job = None
        start_name, start_x, start_y = self.get_start_point()
        rows_data = [row.get_data() for row in self.rows]

        stations, resolved, errors = sc.compute_stations(start_name, start_x, start_y, rows_data)

        error_rows = {i for i, _ in errors}
        for i, row in enumerate(self.rows):
            row.flag_error(i in error_rows)

        if errors:
            messages = [f"Row {i + 1}: {msg}" for i, msg in errors]
            self.error_label.configure(text="\n".join(messages))
        else:
            self.error_label.configure(text="")

        self.draw_preview(stations, resolved, start_name)

    def draw_preview(self, stations, resolved, start_name):
        self.ax.clear()

        for shot in resolved:
            x1, y1 = shot["from_pos"]
            x2, y2 = shot["to_pos"]
            style = "--" if shot["is_closure"] else "-"
            color = "#888780" if shot["is_closure"] else "#0C447C"
            self.ax.plot([x1, x2], [y1, y2], style, color=color, linewidth=1.5, zorder=2)

            if not shot["is_closure"]:
                left_tick = sc.lrud_tick((x2, y2), shot["azimuth"], "L", shot["left"])
                right_tick = sc.lrud_tick((x2, y2), shot["azimuth"], "R", shot["right"])
                for tick in (left_tick, right_tick):
                    if tick:
                        (tx1, ty1), (tx2, ty2) = tick
                        self.ax.plot([tx1, tx2], [ty1, ty2], "-", color="#BA7517",
                                     linewidth=1.0, zorder=1)

        for name, data in stations.items():
            x, y = data["pos"]
            self.ax.plot(x, y, "o", color="#712B13", markersize=5, zorder=3)
            label = name
            z = data.get("z", 0.0)
            if abs(z) > 1e-6:
                label += f"\n(Z{'+' if z >= 0 else ''}{z:.1f})"
            self.ax.annotate(label, (x, y), textcoords="offset points",
                              xytext=(6, 6), fontsize=8, color="#2C2C2A")

        self.ax.set_aspect("equal", adjustable="datalim")
        self.ax.grid(True, linewidth=0.4, alpha=0.4)
        self.ax.set_xlabel("East (+X)", fontsize=8)
        self.ax.set_ylabel("North (+Y)", fontsize=8)
        self.ax.tick_params(labelsize=7)
        self.canvas.draw_idle()

    def generate_dxf(self):
        start_name, start_x, start_y = self.get_start_point()
        rows_data = [row.get_data() for row in self.rows]

        stations, resolved, errors = sc.compute_stations(start_name, start_x, start_y, rows_data)

        if len(resolved) == 0:
            messagebox.showwarning("Generate DXF", "No valid shots to draw yet.")
            return

        if errors:
            messages = "\n".join(f"Row {i + 1}: {msg}" for i, msg in errors)
            proceed = messagebox.askyesno(
                "Generate DXF",
                f"{len(errors)} row(s) have errors and will be skipped:\n\n{messages}\n\n"
                "Generate the DXF anyway with the remaining valid shots?"
            )
            if not proceed:
                return

        output_path = filedialog.asksaveasfilename(
            title="Save Survey DXF As",
            defaultextension=".dxf",
            filetypes=[("DXF files", "*.dxf"), ("All files", "*.*")],
        )
        if not output_path:
            return

        try:
            resolved, stations, errors = sc.build_dxf(
                self.template_path, output_path,
                {k: v.get() for k, v in self.header_vars.items()},
                start_name, start_x, start_y, rows_data,
            )
        except Exception as e:
            messagebox.showerror("Generate DXF", f"Failed to generate DXF:\n\n{e}")
            return

        messagebox.showinfo(
            "Generate DXF",
            f"Saved to:\n{output_path}\n\n"
            f"Stations plotted: {len(stations)}\n"
            f"Shots drawn: {len(resolved)}"
        )


def find_template():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # templates/ sits beside app/ in the repo; also accept a copy dropped next
    # to the script, for someone who just downloaded the app on its own.
    for candidate in (
        os.path.join(script_dir, os.pardir, "templates", TEMPLATE_FILENAME),
        os.path.join(script_dir, TEMPLATE_FILENAME),
    ):
        if os.path.exists(candidate):
            return os.path.normpath(candidate)
    candidate = os.path.join(script_dir, TEMPLATE_FILENAME)
    if os.path.isfile(candidate):
        return candidate
    return None


def main():
    root = tk.Tk()
    template_path = find_template()
    if template_path is None:
        messagebox.showinfo(
            "Locate Template",
            f"Couldn't find {TEMPLATE_FILENAME} in the templates folder.\n"
            "Please locate it now."
        )
        template_path = filedialog.askopenfilename(
            title="Locate NSS_Cave_Template_PLAN.dxf",
            filetypes=[("DXF files", "*.dxf"), ("All files", "*.*")],
        )
        if not template_path:
            sys.exit(0)

    app = CaveSurveyApp(root, template_path)
    root.geometry("1100x650")
    root.mainloop()


if __name__ == "__main__":
    main()
