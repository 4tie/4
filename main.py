import tkinter as tk
from tkinter import font, ttk
import json
import os

try:
    try:
        from pynput.keyboard import Controller, Key
    except ImportError:
        from pynput_robocorp_fork.keyboard import Controller, Key
    HAS_PYNPUT = True
except ImportError:
    HAS_PYNPUT = False

# Mapping for special key combinations
COMMANDS = {
    "Copy": ["ctrl", "c"],
    "Paste": ["ctrl", "v"],
    "Ctrl": ["ctrl"],
    "Shift": ["shift"],
    "Tab": ["tab"],
}

PROFILES = {
    "QWERTY": [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';'],
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'],
        ['Space', 'Enter', 'Backspace']
    ],
    "Numeric": [
        ['1', '2', '3'],
        ['4', '5', '6'],
        ['7', '8', '9'],
        ['0', '.', 'Enter'],
        ['Backspace', 'Alt:QWERTY']
    ],
    "Functions": [
        ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'],
        ['F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
        ['Copy', 'Paste', 'Ctrl', 'Shift', 'Tab'],
        ['Alt:QWERTY']
    ],
    "Gaming": [
        ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5'],
        ['`', '1', '2', '3', '4', '5'],
        ['Tab', 'Q', 'W', 'E', 'R', 'T'],
        ['Shift', 'A', 'S', 'D', 'F', 'G'],
        ['Ctrl', 'Alt', 'Space', 'Enter', 'Alt:QWERTY']
    ],
    "Media": [
        ['Esc', 'F1', 'F2', 'F3', 'F4'],
        ['1', '2', '3', '4', '5'],
        ['Copy', 'Paste', 'Tab', 'Enter'],
        ['Ctrl', 'Shift', 'Alt', 'Space'],
        ['Backspace', 'Alt:QWERTY']
    ],
    "Minimal": [
        ['Q', 'W', 'E', 'R', 'T', 'Y'],
        ['A', 'S', 'D', 'F', 'G', 'H'],
        ['Z', 'X', 'C', 'V', 'B', 'N'],
        ['Space', 'Enter', 'Backspace', 'Alt:Numeric']
    ],
    "Symbols": [
        ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
        ['-', '=', '_', '+', '[', ']', '{', '}', '\\', '|'],
        [':', '"', ';', '\'', '<', '>', ',', '.', '?', '/'],
        ['Backspace', 'Enter', 'Space', 'Alt:QWERTY']
    ],
    "Arrows": [
        ['Esc', 'F1', 'F2', 'F3'],
        ['Insert', 'Home', 'Page Up'],
        ['Delete', 'End', 'Page Down'],
        ['Up', 'Left', 'Down', 'Right'],
        ['Space', 'Enter', 'Alt:QWERTY']
    ],
    "Coding": [
        ['{', '}', '(', ')', '[', ']', '<', '>'],
        ['=', '+', '-', '*', '/', '%', '!', '&', '|'],
        [';', ':', '.', ',', '"', '\'', '`', '\\', '_'],
        ['Copy', 'Paste', 'Tab', 'Space', 'Enter', 'Backspace'],
        ['Alt:Coding_Letters', 'Alt:Functions']
    ],
    "Coding_Letters": [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';'],
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'],
        ['Tab', 'Space', 'Enter', 'Backspace'],
        ['Alt:Coding', 'Alt:Numeric']
    ],
    "Functional": [
        ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5'],
        ['F6', 'F7', 'F8', 'F9', 'F10', 'F11'],
        ['F12', 'Print', 'Scroll', 'Pause'],
        ['Insert', 'Home', 'PgUp', 'Del', 'End', 'PgDn'],
        ['Tab', 'Ctrl', 'Alt', 'Shift', 'Win', 'Alt:QWERTY']
    ],
    "Compact": [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Enter'],
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Space', 'Backspace'],
        ['Alt:Numeric', 'Alt:Functions']
    ]
}

BG_COLOR = "#0E1525"
BTN_BG = "#1C2333"
BTN_FG = "#FFFFFF"
BTN_HOVER = "#0079F2"
BTN_ACTIVE = "#F5A623"
BTN_BORDER = "#2D3748"

CONFIG_FILE = "config.json"

AVAILABLE_KEYS = [
    '1','2','3','4','5','6','7','8','9','0','-','=','Backspace',
    'Q','W','E','R','T','Y','U','I','O','P','[',']','\\',
    'A','S','D','F','G','H','J','K','L',';','\'','Enter',
    'Z','X','C','V','B','N','M',',','.','/','Shift',
    'Space','Tab','Ctrl','Alt','Win','Esc',
    '!','@','#','$','%','^','&','*','(',')','_','+',
    '{','}','|',':','"','<','>','?',
    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
    'Copy','Paste',
    'Insert', 'Home', 'Page Up', 'Delete', 'End', 'Page Down',
    'Up', 'Down', 'Left', 'Right',
    'Print', 'Scroll', 'Pause', 'PgUp', 'PgDn', 'Del'
]

class KeyboardApp:
    def __init__(self, root):
        self.root = root
        self.load_config()
        self.current_layout = None  # Temporary layout override
        self.setup_ui()
        
        if HAS_PYNPUT:
            self.keyboard = Controller()
        else:
            self.keyboard = None

    def load_config(self):
        default_config = {
            "profile": "QWERTY", 
            "always_on_top": True, 
            "sound_enabled": True,
            "custom_mappings": {},
            "custom_profiles": {
                "My Layout": [["A", "B", "C"], ["1", "2", "3"]]
            }
        }
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r') as f:
                    self.config = json.load(f)
                    if "custom_profiles" not in self.config:
                        self.config["custom_profiles"] = default_config["custom_profiles"]
            except:
                self.config = default_config
        else:
            self.config = default_config

    def save_config(self):
        with open(CONFIG_FILE, 'w') as f:
            json.dump(self.config, f)

    def setup_ui(self):
        self.root.title('On-Screen Keyboard Pro')
        self.root.attributes('-topmost', self.config.get("always_on_top", True))
        self.root.configure(bg=BG_COLOR)
        
        # Performance optimization: Double buffering and smoother rendering hints
        self.root.option_add('*tearOff', tk.FALSE)
        
        # Draggable window without title bar option
        self.root.bind("<Button-1>", self.start_move)
        self.root.bind("<B1-Motion>", self.do_move)
        
        self.main_frame = tk.Frame(self.root, bg=BG_COLOR)
        self.main_frame.pack(fill=tk.BOTH, expand=True)
        
        # Settings Bar with more spacing
        self.settings_frame = tk.Frame(self.main_frame, bg=BTN_BG, pady=5)
        self.settings_frame.pack(fill=tk.X, padx=5, pady=2)
        
        tk.Label(self.settings_frame, text="LAYOUT:", bg=BTN_BG, fg=BTN_HOVER, font=('Courier', 10, 'bold')).pack(side=tk.LEFT, padx=10)
        
        self.profile_var = tk.StringVar(value=self.config.get("profile", "QWERTY"))
        self.update_profile_list()
        
        # Stylish combobox
        style = ttk.Style()
        style.theme_use('clam')
        style.configure("TCombobox", fieldbackground=BTN_BG, background=BTN_BG, foreground=BTN_FG, arrowcolor=BTN_FG)
        
        self.profile_menu = ttk.Combobox(self.settings_frame, textvariable=self.profile_var, values=self.profile_values, width=20, style="TCombobox")
        self.profile_menu.pack(side=tk.LEFT, padx=5)
        self.profile_menu.bind("<<ComboboxSelected>>", self.change_profile)

        # Action Buttons
        tk.Button(self.settings_frame, text="DESIGNER", command=self.open_options, bg=BTN_BG, fg=BTN_ACTIVE, 
                  relief='flat', activebackground=BTN_HOVER, font=('Courier', 9, 'bold'), borderwidth=0).pack(side=tk.LEFT, padx=15)
        
        # Sound Toggle
        self.sound_var = tk.BooleanVar(value=self.config.get("sound_enabled", True))
        self.sound_btn = tk.Checkbutton(self.settings_frame, text="SOUND", variable=self.sound_var, command=self.toggle_sound,
                       bg=BTN_BG, fg=BTN_FG, selectcolor=BG_COLOR, activebackground=BTN_BG,
                       font=('Courier', 9), highlightthickness=0)
        self.sound_btn.pack(side=tk.RIGHT, padx=5)

        # Visual feedback for always on top
        self.top_var = tk.BooleanVar(value=self.config.get("always_on_top", True))
        self.top_btn = tk.Checkbutton(self.settings_frame, text="FLOATING", variable=self.top_var, command=self.toggle_top, 
                                     bg=BTN_BG, fg=BTN_FG, selectcolor=BG_COLOR, activebackground=BTN_BG,
                                     font=('Courier', 9), highlightthickness=0)
        self.top_btn.pack(side=tk.RIGHT, padx=10)

    def start_move(self, event):
        # Only allow dragging from the main_frame or settings_frame
        if event.widget in [self.main_frame, self.settings_frame, self.root]:
            self.x = event.x
            self.y = event.y
        else:
            self.x = None

    def do_move(self, event):
        if getattr(self, 'x', None) is not None:
            deltax = event.x - self.x
            deltay = event.y - self.y
            x = self.root.winfo_x() + deltax
            y = self.root.winfo_y() + deltay
            self.root.geometry(f"+{x}+{y}")

    def toggle_sound(self):
        self.config["sound_enabled"] = self.sound_var.get()
        self.save_config()

        self.keyboard_frame = tk.Frame(self.main_frame, bg=BG_COLOR)
        self.keyboard_frame.pack(pady=5)
        self.create_keyboard()

    def add_key_to_preview(self, key):
        self.working_row.append(key)
        self.update_editor_preview()

    def finish_row(self):
        if self.working_row:
            self.current_rows_preview.append(list(self.working_row))
            self.working_row.clear()
            self.update_editor_preview()

    def open_options(self):
        opts = tk.Toplevel(self.root)
        opts.title("Configuration")
        opts.configure(bg=BG_COLOR)
        opts.geometry("800x800")
        
        # Main container with padding to ensure nothing hits the edges
        container = tk.Frame(opts, bg=BG_COLOR, padx=10, pady=10)
        container.pack(fill=tk.BOTH, expand=True)
        
        tk.Label(container, text="Profile Editor", bg=BG_COLOR, fg=BTN_FG, font=('Courier', 12, 'bold')).pack(pady=(0, 10))
        
        content_frame = tk.Frame(container, bg=BG_COLOR)
        content_frame.pack(fill=tk.BOTH, expand=True)
        
        # Left side: Key Grid
        left_frame = tk.Frame(content_frame, bg=BG_COLOR)
        left_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 5))
        
        tk.Label(left_frame, text="1. Select Keys", bg=BG_COLOR, fg=BTN_FG, font=('Courier', 10, 'bold')).pack(pady=5)
        
        # Scrollable area for keys
        grid_container = tk.Canvas(left_frame, bg=BG_COLOR, highlightthickness=1, highlightbackground=BTN_BORDER)
        scrollbar = tk.Scrollbar(left_frame, orient="vertical", command=grid_container.yview)
        scrollable_frame = tk.Frame(grid_container, bg=BG_COLOR)
        
        scrollable_frame.bind("<Configure>", lambda e: grid_container.configure(scrollregion=grid_container.bbox("all")))
        grid_container.create_window((0, 0), window=scrollable_frame, anchor="nw")
        grid_container.configure(yscrollcommand=scrollbar.set)
        
        grid_container.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # Build key grid
        # Add Special Alt keys to available keys for editor
        editor_keys = AVAILABLE_KEYS + [f"Alt:{p}" for p in PROFILES.keys()]
        
        for i, key in enumerate(editor_keys):
            r, c = divmod(i, 3) # Fewer columns to fit inside better
            tk.Button(scrollable_frame, text=key, width=10, command=lambda k=key: self.add_key_to_preview(k),
                      bg=BTN_BG, fg=BTN_FG, relief='flat').grid(row=r, column=c, padx=2, pady=2)

        # Right side: Preview & Editor
        right_frame = tk.Frame(content_frame, bg=BTN_BG, padx=5, pady=5)
        right_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=(5, 0))
        
        tk.Label(right_frame, text="2. Preview & Arrange", bg=BTN_BG, fg=BTN_FG, font=('Courier', 10, 'bold')).pack(pady=5)
        
        name_frame = tk.Frame(right_frame, bg=BTN_BG)
        name_frame.pack(fill=tk.X, padx=5, pady=5)
        tk.Label(name_frame, text="Name:", bg=BTN_BG, fg=BTN_FG, font=('Arial', 8)).pack(side=tk.LEFT)
        self.new_profile_name = tk.Entry(name_frame, font=('Arial', 9))
        self.new_profile_name.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        self.new_profile_name.insert(0, "Custom Layout")

        # Scrollable preview area
        preview_container = tk.Canvas(right_frame, bg=BG_COLOR, highlightthickness=1, highlightbackground=BTN_BORDER)
        preview_scrollbar = tk.Scrollbar(right_frame, orient="vertical", command=preview_container.yview)
        self.preview_area = tk.Frame(preview_container, bg=BG_COLOR)
        
        self.preview_area.bind("<Configure>", lambda e: preview_container.configure(scrollregion=preview_container.bbox("all")))
        preview_container.create_window((0, 0), window=self.preview_area, anchor="nw")
        preview_container.configure(yscrollcommand=preview_scrollbar.set)
        
        preview_container.pack(side="top", fill="both", expand=True, padx=5, pady=5)
        preview_scrollbar.pack(side="right", fill="y", in_=right_frame)
        
        # Maintain editor state
        if not hasattr(self, 'current_rows_preview'): self.current_rows_preview = [] 
        if not hasattr(self, 'working_row'): self.working_row = [] 
        
        self.update_editor_preview()

        controls = tk.Frame(right_frame, bg=BTN_BG, pady=5)
        controls.pack(side=tk.BOTTOM, fill=tk.X)
        
        tk.Button(controls, text="New Row", command=self.finish_row, bg=BTN_HOVER, fg="white", font=('Arial', 9, 'bold')).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        tk.Button(controls, text="Save Profile", command=lambda: self.save_custom_profile(opts), bg=BTN_ACTIVE, fg=BG_COLOR, font=('Arial', 9, 'bold')).pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)

        # List existing to delete and edit
        tk.Label(container, text="Manage Profiles:", bg=BG_COLOR, fg=BTN_FG, font=('Courier', 10, 'bold')).pack(pady=(10, 0))
        manage_container = tk.Canvas(container, bg=BG_COLOR, highlightthickness=1, highlightbackground=BTN_BORDER, height=150)
        manage_scrollbar = tk.Scrollbar(container, orient="vertical", command=manage_container.yview)
        manage_frame = tk.Frame(manage_container, bg=BG_COLOR)
        
        manage_frame.bind("<Configure>", lambda e: manage_container.configure(scrollregion=manage_container.bbox("all")))
        manage_container.create_window((0, 0), window=manage_frame, anchor="nw")
        manage_container.configure(yscrollcommand=manage_scrollbar.set)
        
        manage_container.pack(fill=tk.BOTH, expand=True, padx=20, pady=5)
        manage_scrollbar.pack(side="right", fill="y", in_=manage_container)

        # Show BOTH built-in and custom profiles for editing/duplicating
        all_profiles = {**PROFILES, **self.config.get("custom_profiles", {})}
        for name, layout in all_profiles.items():
            is_builtin = name in PROFILES
            f = tk.Frame(manage_frame, bg=BTN_BG, pady=2)
            f.pack(fill=tk.X, pady=1)
            tk.Label(f, text=f"{name} {'(System)' if is_builtin else ''}", bg=BTN_BG, fg=BTN_FG if not is_builtin else BTN_HOVER).pack(side=tk.LEFT, padx=5)
            
            # Built-in profiles can be edited as a template (save as new), custom can be overwritten
            tk.Button(f, text="Edit", command=lambda n=name, l=layout: self.load_profile_to_editor(n, l), bg=BTN_HOVER, fg="white", font=('Arial', 8)).pack(side=tk.RIGHT, padx=2)
            if not is_builtin:
                tk.Button(f, text="X", command=lambda n=name: self.delete_custom_profile(n, opts), bg="#ff4444", fg="white", font=('Arial', 8)).pack(side=tk.RIGHT, padx=5)

    def update_editor_preview(self):
        if not hasattr(self, 'preview_area') or not self.preview_area.winfo_exists():
            return

        for widget in self.preview_area.winfo_children():
            widget.destroy()
            
        # Preview Header
        tk.Label(self.preview_area, text="LAYOUT PREVIEW", bg="#2D3748", fg="#F5A623", font=('Courier', 10, 'bold'), pady=5).pack(fill=tk.X)

        # Display completed rows
        for r_idx, row in enumerate(self.current_rows_preview):
            row_outer = tk.Frame(self.preview_area, bg=BG_COLOR, highlightbackground=BTN_BORDER, highlightthickness=1)
            row_outer.pack(fill=tk.X, pady=4, padx=5)
            
            row_info = tk.Frame(row_outer, bg="#1C2333", width=40)
            row_info.pack(side=tk.LEFT, fill=tk.Y)
            row_info.pack_propagate(False)
            
            tk.Label(row_info, text=f"R{r_idx+1}", bg="#1C2333", fg="#F5A623", font=('Arial', 7, 'bold')).pack(pady=(2,0))
            btn_f = tk.Frame(row_info, bg="#1C2333")
            btn_f.pack()
            tk.Button(btn_f, text="▲", command=lambda r=r_idx: self.move_row(r, -1), width=2, height=1, font=('Arial', 7), bd=1, bg=BTN_BG, fg=BTN_FG).pack(side=tk.LEFT, padx=1)
            tk.Button(btn_f, text="▼", command=lambda r=r_idx: self.move_row(r, 1), width=2, height=1, font=('Arial', 7), bd=1, bg=BTN_BG, fg=BTN_FG).pack(side=tk.LEFT, padx=1)

            keys_wrapper = tk.Frame(row_outer, bg=BG_COLOR, padx=5, pady=5)
            keys_wrapper.pack(side=tk.LEFT, fill=tk.X, expand=True)
            
            for k_idx, key in enumerate(row):
                k_box = tk.Frame(keys_wrapper, bg=BTN_BG, highlightbackground="#0079F2", highlightthickness=1)
                k_box.pack(side=tk.LEFT, padx=2, pady=2)
                
                # Check for is_alt display text
                display_text = key.split(":")[1] if key.startswith("Alt:") else key
                tk.Label(k_box, text=display_text, bg=BTN_BG, fg=BTN_FG if not key.startswith("Alt:") else BTN_ACTIVE, 
                         padx=6, pady=2, font=('Courier', 9, 'bold')).pack()
                
                ctrls = tk.Frame(k_box, bg="#0E1525")
                ctrls.pack(fill=tk.X)
                tk.Button(ctrls, text="<", command=lambda r=r_idx, k=k_idx: self.move_key(r, k, -1), width=1, font=('Arial', 7), bg=BTN_BG, fg=BTN_FG).pack(side=tk.LEFT)
                tk.Button(ctrls, text="×", command=lambda r=r_idx, k=k_idx: self.remove_key(r, k), width=1, font=('Arial', 7), bg="#ff4444", fg="white").pack(side=tk.LEFT)
                tk.Button(ctrls, text=">", command=lambda r=r_idx, k=k_idx: self.move_key(r, k, 1), width=1, font=('Arial', 7), bg=BTN_BG, fg=BTN_FG).pack(side=tk.LEFT)

        # Display working row
        if self.working_row:
            work_frame = tk.Frame(self.preview_area, bg="#1C2333", highlightbackground=BTN_HOVER, highlightthickness=2)
            work_frame.pack(fill=tk.X, pady=15, padx=5)
            
            header = tk.Frame(work_frame, bg=BTN_HOVER)
            header.pack(fill=tk.X)
            tk.Label(header, text="SELECTED KEYS (Current Row)", bg=BTN_HOVER, fg="white", font=('Arial', 8, 'bold')).pack(pady=2)
            
            keys_row = tk.Frame(work_frame, bg="#1C2333", pady=10, padx=10)
            keys_row.pack(fill=tk.X)
            
            for key in self.working_row:
                tk.Label(keys_row, text=key, bg=BTN_BG, fg=BTN_FG, padx=8, pady=4, font=('Courier', 10, 'bold'), highlightbackground=BTN_BORDER, highlightthickness=1).pack(side=tk.LEFT, padx=2)
            
            tk.Button(work_frame, text="Clear Current Row Selection", command=lambda: [self.working_row.clear(), self.update_editor_preview()], bg="#ff4444", fg="white", font=('Arial', 8)).pack(pady=5)



    def move_row(self, r_idx, direction):
        new_idx = r_idx + direction
        if 0 <= new_idx < len(self.current_rows_preview):
            self.current_rows_preview[r_idx], self.current_rows_preview[new_idx] = \
                self.current_rows_preview[new_idx], self.current_rows_preview[r_idx]
            self.update_editor_preview()

    def move_key(self, r_idx, k_idx, direction):
        row = self.current_rows_preview[r_idx]
        new_idx = k_idx + direction
        if 0 <= new_idx < len(row):
            row[k_idx], row[new_idx] = row[new_idx], row[k_idx]
            self.update_editor_preview()

    def remove_key(self, r_idx, k_idx):
        self.current_rows_preview[r_idx].pop(k_idx)
        if not self.current_rows_preview[r_idx]:
            self.current_rows_preview.pop(r_idx)
        self.update_editor_preview()

    def delete_custom_profile(self, name, window):
        if name in self.config["custom_profiles"]:
            del self.config["custom_profiles"][name]
            self.save_config()
            self.update_profile_list()
            window.destroy()
            self.open_options()

    def add_key_to_preview(self, key):
        self.working_row.append(key)
        self.update_editor_preview()

    def update_profile_list(self):
        self.profile_values = list(PROFILES.keys()) + list(self.config.get("custom_profiles", {}).keys())
        if hasattr(self, 'profile_menu'):
            self.profile_menu['values'] = self.profile_values

    def toggle_top(self):
        val = self.top_var.get()
        self.root.attributes('-topmost', val)
        self.config["always_on_top"] = val
        self.save_config()

    def change_profile(self, event=None):
        profile = self.profile_var.get()
        self.config["profile"] = profile
        self.current_layout = None # Reset temporary override when manually changing profile
        self.save_config()
        self.create_keyboard()

    def create_keyboard(self):
        for widget in self.keyboard_frame.winfo_children():
            widget.destroy()
            
        # Use current_layout if set (for Alt switching), otherwise use profile from config
        profile_name = self.current_layout if self.current_layout else self.config.get("profile", "QWERTY")
        layout = PROFILES.get(profile_name)
        if not layout:
            layout = self.config["custom_profiles"].get(profile_name, PROFILES.get("QWERTY"))
            
        btn_font = font.Font(family='Courier', size=13, weight='bold')

        # Use a container to keep the keyboard centered and contained
        keyboard_container = tk.Frame(self.keyboard_frame, bg=BG_COLOR, padx=10, pady=10)
        keyboard_container.pack()

        for r, keys in enumerate(layout):
            frame = tk.Frame(keyboard_container, bg=BG_COLOR)
            frame.pack(pady=3)
            for key in keys:
                # Highlight active layout switchers
                is_alt = key.startswith("Alt:")
                display_text = key.split(":")[1] if is_alt else key
                
                # Calculate width based on key type
                if key == 'Space': width = 22
                elif key in ['Enter', 'Backspace', 'Shift', 'Tab']: width = 11
                elif key in ['Ctrl', 'Alt', 'Win', 'Esc']: width = 7
                elif is_alt: width = 12
                else: width = 5
                
                fg_color = BTN_ACTIVE if is_alt else BTN_FG
                
                btn = tk.Button(frame, text=display_text, width=width, height=2, bg=BTN_BG, fg=fg_color,
                                activebackground=BTN_ACTIVE, activeforeground=BG_COLOR,
                                highlightbackground=BTN_BORDER, highlightthickness=1,
                                relief='flat', font=btn_font,
                                command=lambda k=key: self.on_click(k))
                btn.pack(side=tk.LEFT, padx=3)
                
                # Hover effect with slight color shift
                btn.bind('<Enter>', lambda e, b=btn: b.configure(bg=BTN_HOVER))
                btn.bind('<Leave>', lambda e, b=btn: b.configure(bg=BTN_BG))

    def on_click(self, char):
        print(f"Key pressed: {char}")
        
        # Handle dynamic layout switching (without changing persistent profile)
        if char.startswith("Alt:"):
            target_layout = char.split(":")[1]
            # Normalize target name for Coding_Letters case
            if target_layout == "Coding_Letters" or target_layout in PROFILES or target_layout in self.config.get("custom_profiles", {}):
                self.current_layout = target_layout
                self.create_keyboard()
            return

        if not HAS_PYNPUT: return
        try:
            # Sound feedback (visual representation if sound drivers unavailable)
            if self.config.get("sound_enabled", True):
                self.root.bell()
            
            # Add visual feedback on click
            self.root.after(10, lambda: self.root.configure(bg="#1a2a4a"))
            self.root.after(100, lambda: self.root.configure(bg=BG_COLOR))
            
            # Handle special commands/macros
            if char in COMMANDS:
                keys_to_press = COMMANDS[char]
                actual_keys = []
                for k in keys_to_press:
                    if hasattr(Key, k.lower()):
                        actual_keys.append(getattr(Key, k.lower()))
                    else:
                        actual_keys.append(k.lower())
                
                # Press all
                for k in actual_keys: self.keyboard.press(k)
                # Release all
                for k in reversed(actual_keys): self.keyboard.release(k)
                return

            # Handle Function Keys
            if char.startswith('F') and char[1:].isdigit():
                f_key = getattr(Key, char.lower())
                self.keyboard.press(f_key); self.keyboard.release(f_key)
                return

            # Special key handling for pynput
            special_map = {
                'Space': Key.space,
                'Enter': Key.enter,
                'Backspace': Key.backspace,
                'Tab': Key.tab,
                'Ctrl': Key.ctrl,
                'Shift': Key.shift,
                'Alt': Key.alt,
                'Win': Key.cmd,
                'Esc': Key.esc,
                'Up': Key.up,
                'Down': Key.down,
                'Left': Key.left,
                'Right': Key.right,
                'Insert': Key.insert,
                'Home': Key.home,
                'End': Key.end,
                'Page Up': Key.page_up,
                'Page Down': Key.page_down,
                'Delete': Key.delete,
                'Print': Key.print_screen,
                'Scroll': Key.scroll_lock,
                'Pause': Key.pause,
                'PgUp': Key.page_up,
                'PgDn': Key.page_down,
                'Del': Key.delete
            }

            if char in special_map:
                key = special_map[char]
                self.keyboard.press(key)
                self.keyboard.release(key)
            else:
                self.keyboard.type(char)
        except Exception as e:
            print(f"Error typing {char}: {e}")

if __name__ == '__main__':
    root = tk.Tk()
    app = KeyboardApp(root)
    root.mainloop()