#!/usr/bin/env python3
import tkinter as tk
from tkinter import ttk, messagebox
import subprocess
import json
import os
import threading
import time

CONFIG_FILE = os.path.expanduser("~/.osk_custom_keys.json")

COLORS = {
    'bg_dark': '#0a0a0a',
    'bg_medium': '#151515',
    'bg_light': '#1f1f1f',
    'accent': '#c41e3a',
    'accent_hover': '#e63946',
    'accent_light': '#f77f88',
    'accent_glow': '#660000',
    'success': '#2a9d2a',
    'success_hover': '#3db13d',
    'danger': '#ff4444',
    'text': '#ffffff',
    'text_dim': '#888888',
    'key_bg': '#0f0f0f',
    'key_hover': '#1a1a1a',
    'key_press': '#2a2a2a',
    'key_border': '#1a1a1a',
    'modifier_active': '#8b2e2e',
    'custom_bg': '#5c1e1e',
    'custom_hover': '#7a2a2a',
    'shadow': '#000000',
    'border': '#333333'
}


class CustomKeyDialog(tk.Toplevel):
    def __init__(self, parent, existing_key=None):
        super().__init__(parent)
        self.title("Add Custom Shortcut" if not existing_key else "Edit Custom Shortcut")
        self.result = None
        self.transient(parent)
        self.grab_set()
        
        self.configure(bg=COLORS['bg_dark'])
        self.geometry("400x420")
        self.resizable(False, False)
        
        main_frame = tk.Frame(self, bg=COLORS['bg_dark'], padx=25, pady=20)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        title = tk.Label(main_frame, text="✨ New Shortcut" if not existing_key else "✏️ Edit Shortcut",
                        font=('Segoe UI', 14, 'bold'), bg=COLORS['bg_dark'], fg=COLORS['text'])
        title.pack(anchor=tk.W, pady=(0, 15))
        
        tk.Label(main_frame, text="NAME", font=('Segoe UI', 9, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text_dim']).pack(anchor=tk.W)
        
        name_frame = tk.Frame(main_frame, bg=COLORS['key_border'], padx=1, pady=1)
        name_frame.pack(fill=tk.X, pady=(5, 15))
        self.name_entry = tk.Entry(name_frame, font=('Segoe UI', 12), width=30,
                                   bg=COLORS['bg_medium'], fg=COLORS['text'],
                                   insertbackground=COLORS['accent'], relief='flat',
                                   highlightthickness=0)
        self.name_entry.pack(fill=tk.X, ipady=8, padx=1, pady=1)
        
        tk.Label(main_frame, text="TYPE", font=('Segoe UI', 9, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text_dim']).pack(anchor=tk.W)
        
        self.type_var = tk.StringVar(value='keys')
        type_frame = tk.Frame(main_frame, bg=COLORS['bg_dark'])
        type_frame.pack(fill=tk.X, pady=(5, 15))
        
        self.key_radio = self.create_radio(type_frame, "⌨️ Key Combo", 'keys')
        self.key_radio.pack(side=tk.LEFT)
        self.word_radio = self.create_radio(type_frame, "📝 Text", 'word')
        self.word_radio.pack(side=tk.LEFT, padx=20)
        
        self.content_frame = tk.Frame(main_frame, bg=COLORS['bg_dark'])
        self.content_frame.pack(fill=tk.BOTH, expand=True)
        
        self.keys_frame = tk.Frame(self.content_frame, bg=COLORS['bg_dark'])
        self.word_frame = tk.Frame(self.content_frame, bg=COLORS['bg_dark'])
        
        available_keys = ['None', 'Ctrl', 'Alt', 'Shift', 'Super'] + list('abcdefghijklmnopqrstuvwxyz') + \
                        list('0123456789') + [f'F{i}' for i in range(1, 13)] + \
                        ['Space', 'Enter', 'Tab', 'Escape', 'BackSpace', 'Delete', 'Home', 'End', 'Up', 'Down', 'Left', 'Right']
        
        self.key_vars = []
        for i in range(3):
            row = tk.Frame(self.keys_frame, bg=COLORS['bg_dark'])
            row.pack(fill=tk.X, pady=3)
            tk.Label(row, text=f"Key {i+1}", font=('Segoe UI', 10),
                    bg=COLORS['bg_dark'], fg=COLORS['text_dim'], width=6).pack(side=tk.LEFT)
            var = tk.StringVar(value='None')
            self.key_vars.append(var)
            combo = ttk.Combobox(row, textvariable=var, values=available_keys, state='readonly', width=18)
            combo.pack(side=tk.LEFT, padx=10)
            var.trace_add('write', self.update_preview)
        
        tk.Label(self.word_frame, text="Text to type:", font=('Segoe UI', 10),
                bg=COLORS['bg_dark'], fg=COLORS['text_dim']).pack(anchor=tk.W)
        word_entry_frame = tk.Frame(self.word_frame, bg=COLORS['key_border'], padx=1, pady=1)
        word_entry_frame.pack(fill=tk.X, pady=5)
        self.word_entry = tk.Entry(word_entry_frame, font=('Segoe UI', 12),
                                   bg=COLORS['bg_medium'], fg=COLORS['text'],
                                   insertbackground=COLORS['accent'], relief='flat')
        self.word_entry.pack(fill=tk.X, ipady=8, padx=1, pady=1)
        
        preview_frame = tk.Frame(main_frame, bg=COLORS['bg_light'], padx=12, pady=8)
        preview_frame.pack(fill=tk.X, pady=(15, 0))
        self.preview_label = tk.Label(preview_frame, text="Preview: select options",
                                      font=('Segoe UI', 10), bg=COLORS['bg_light'], fg=COLORS['accent'])
        self.preview_label.pack(anchor=tk.W)
        
        btn_frame = tk.Frame(main_frame, bg=COLORS['bg_dark'])
        btn_frame.pack(fill=tk.X, pady=(20, 0))
        
        self.create_button(btn_frame, "Cancel", self.cancel, width=10).pack(side=tk.RIGHT, padx=5)
        self.create_button(btn_frame, "Save", self.save, accent=True, width=10).pack(side=tk.RIGHT)
        
        if existing_key:
            self.name_entry.insert(0, existing_key.get('name', ''))
            if existing_key.get('type') == 'word':
                self.type_var.set('word')
                self.word_entry.insert(0, existing_key.get('word', ''))
            else:
                for i, key in enumerate(existing_key.get('keys', [])[:3]):
                    self.key_vars[i].set(key)
        
        self.toggle_type()
        self.type_var.trace_add('write', lambda *a: self.toggle_type())
        self.update_preview()
        self.wait_window()
    
    def create_radio(self, parent, text, value):
        return tk.Radiobutton(parent, text=text, variable=self.type_var, value=value,
                             bg=COLORS['bg_dark'], fg=COLORS['text'], selectcolor=COLORS['bg_medium'],
                             activebackground=COLORS['bg_dark'], activeforeground=COLORS['text'],
                             font=('Segoe UI', 10), highlightthickness=0)
    
    def create_button(self, parent, text, command, accent=False, width=12):
        bg = COLORS['accent'] if accent else COLORS['bg_light']
        hover = COLORS['accent_hover'] if accent else COLORS['key_hover']
        btn = tk.Button(parent, text=text, font=('Segoe UI', 10, 'bold'), width=width,
                       bg=bg, fg=COLORS['text'], activebackground=hover,
                       activeforeground=COLORS['text'], relief='flat', cursor='hand2',
                       pady=8, command=command, highlightthickness=0)
        btn.bind('<Enter>', lambda e: btn.configure(bg=hover))
        btn.bind('<Leave>', lambda e: btn.configure(bg=bg))
        return btn
    
    def toggle_type(self):
        self.keys_frame.pack_forget()
        self.word_frame.pack_forget()
        if self.type_var.get() == 'keys':
            self.keys_frame.pack(fill=tk.X)
        else:
            self.word_frame.pack(fill=tk.X)
        self.update_preview()
    
    def update_preview(self, *args):
        if self.type_var.get() == 'word':
            word = self.word_entry.get() if hasattr(self, 'word_entry') else ''
            self.preview_label.config(text=f'Will type: "{word}"' if word else "Enter text above")
        else:
            keys = [v.get() for v in self.key_vars if v.get() != 'None']
            self.preview_label.config(text=f"Will press: {' + '.join(keys)}" if keys else "Select keys above")
    
    def save(self):
        name = self.name_entry.get().strip()
        if not name:
            messagebox.showerror("Error", "Please enter a name")
            return
        if self.type_var.get() == 'word':
            word = self.word_entry.get()
            if not word:
                messagebox.showerror("Error", "Please enter text")
                return
            self.result = {'name': name, 'type': 'word', 'word': word}
        else:
            keys = [v.get() for v in self.key_vars if v.get() != 'None']
            if not keys:
                messagebox.showerror("Error", "Select at least one key")
                return
            self.result = {'name': name, 'type': 'keys', 'keys': keys}
        self.destroy()
    
    def cancel(self):
        self.destroy()


class SettingsDialog(tk.Toplevel):
    def __init__(self, parent, custom_keys, keyboard=None):
        super().__init__(parent)
        self.title("Settings")
        self.custom_keys = custom_keys.copy()
        self.keyboard = keyboard
        self.result = None
        self.accent_color = keyboard.accent_color if keyboard else COLORS['accent']
        self.keyboard_width = keyboard.keyboard_width if keyboard else 15
        self.transient(parent)
        self.grab_set()
        
        self.configure(bg=COLORS['bg_dark'])
        self.geometry("480x650")
        self.resizable(True, True)
        
        main_frame = tk.Frame(self, bg=COLORS['bg_dark'], padx=20, pady=20)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        header = tk.Frame(main_frame, bg=COLORS['bg_dark'])
        header.pack(fill=tk.X, pady=(0, 5))
        tk.Label(header, text="⚡ Your Shortcuts", font=('Segoe UI', 16, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text']).pack(side=tk.LEFT)
        
        tk.Label(main_frame, text="Key combos and text snippets",
                font=('Segoe UI', 10), bg=COLORS['bg_dark'], fg=COLORS['text_dim']).pack(anchor=tk.W, pady=(0, 10))
        
        list_container = tk.Frame(main_frame, bg=COLORS['key_border'], padx=1, pady=1)
        list_container.pack(fill=tk.BOTH, expand=True)
        
        list_inner = tk.Frame(list_container, bg=COLORS['bg_medium'])
        list_inner.pack(fill=tk.BOTH, expand=True)
        
        self.listbox = tk.Listbox(list_inner, font=('Segoe UI', 11), height=6,
                                  bg=COLORS['bg_medium'], fg=COLORS['text'],
                                  selectbackground=COLORS['accent_glow'],
                                  selectforeground=COLORS['text'],
                                  relief='flat', highlightthickness=0,
                                  activestyle='none', borderwidth=0)
        scrollbar = tk.Scrollbar(list_inner, orient=tk.VERTICAL, command=self.listbox.yview,
                                bg=COLORS['bg_medium'], troughcolor=COLORS['bg_dark'],
                                highlightthickness=0, borderwidth=0)
        self.listbox.configure(yscrollcommand=scrollbar.set)
        self.listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5, pady=5)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        self.refresh_list()
        
        shortcut_btn_frame = tk.Frame(main_frame, bg=COLORS['bg_dark'])
        shortcut_btn_frame.pack(fill=tk.X, pady=(10, 0))
        
        self.create_button(shortcut_btn_frame, "＋ Add", self.add_key, success=True).pack(side=tk.LEFT, padx=(0, 8))
        self.create_button(shortcut_btn_frame, "Edit", self.edit_key).pack(side=tk.LEFT, padx=(0, 8))
        self.create_button(shortcut_btn_frame, "Delete", self.delete_key, danger=True).pack(side=tk.LEFT)
        
        opacity_frame = tk.Frame(main_frame, bg=COLORS['bg_dark'])
        opacity_frame.pack(fill=tk.X, pady=(20, 0))
        
        tk.Label(opacity_frame, text="Opacity", font=('Segoe UI', 11, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text']).pack(anchor=tk.W)
        
        slider_frame = tk.Frame(opacity_frame, bg=COLORS['bg_dark'])
        slider_frame.pack(fill=tk.X, pady=(5, 0))
        
        self.opacity_var = tk.DoubleVar(value=keyboard.opacity if keyboard else 0.95)
        self.opacity_label = tk.Label(slider_frame, text=f"{int(self.opacity_var.get() * 100)}%",
                                      font=('Segoe UI', 10), bg=COLORS['bg_dark'], fg=COLORS['text_dim'], width=5)
        self.opacity_label.pack(side=tk.RIGHT)
        
        self.opacity_slider = tk.Scale(slider_frame, from_=0.3, to=1.0, resolution=0.05,
                                       orient=tk.HORIZONTAL, variable=self.opacity_var,
                                       command=self.update_opacity, showvalue=False,
                                       bg=COLORS['bg_medium'], fg=COLORS['text'],
                                       troughcolor=COLORS['bg_light'], highlightthickness=0,
                                       activebackground=COLORS['accent'])
        self.opacity_slider.pack(side=tk.LEFT, fill=tk.X, expand=True)
        
        # Color settings
        color_frame = tk.Frame(main_frame, bg=COLORS['bg_dark'])
        color_frame.pack(fill=tk.X, pady=(20, 0))
        
        tk.Label(color_frame, text="Accent Color", font=('Segoe UI', 11, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text']).pack(anchor=tk.W)
        
        color_btn_frame = tk.Frame(main_frame, bg=COLORS['bg_dark'])
        color_btn_frame.pack(fill=tk.X, pady=(5, 0))
        
        self.color_preview = tk.Label(color_btn_frame, text="  ", bg=self.accent_color,
                                      width=5, relief='solid', borderwidth=1)
        self.color_preview.pack(side=tk.LEFT, padx=(0, 10))
        
        self.create_button(color_btn_frame, "Choose Color", self.choose_color).pack(side=tk.LEFT)
        
        # Size settings
        size_frame = tk.Frame(main_frame, bg=COLORS['bg_dark'])
        size_frame.pack(fill=tk.X, pady=(20, 0))
        
        tk.Label(size_frame, text="Keyboard Width", font=('Segoe UI', 11, 'bold'),
                bg=COLORS['bg_dark'], fg=COLORS['text']).pack(anchor=tk.W)
        
        size_slider_frame = tk.Frame(size_frame, bg=COLORS['bg_dark'])
        size_slider_frame.pack(fill=tk.X, pady=(5, 0))
        
        self.width_var = tk.IntVar(value=self.keyboard_width)
        self.width_label = tk.Label(size_slider_frame, text=f"{self.width_var.get()}",
                                    font=('Segoe UI', 10), bg=COLORS['bg_dark'], fg=COLORS['text_dim'], width=5)
        self.width_label.pack(side=tk.RIGHT)
        
        self.width_slider = tk.Scale(size_slider_frame, from_=10, to=20, resolution=1,
                                     orient=tk.HORIZONTAL, variable=self.width_var,
                                     command=self.update_width, showvalue=False,
                                     bg=COLORS['bg_medium'], fg=COLORS['text'],
                                     troughcolor=COLORS['bg_light'], highlightthickness=0,
                                     activebackground=COLORS['accent'])
        self.width_slider.pack(side=tk.LEFT, fill=tk.X, expand=True)
        
        btn_frame = tk.Frame(main_frame, bg=COLORS['bg_dark'])
        btn_frame.pack(fill=tk.X, pady=(20, 0))
        
        self.create_button(btn_frame, "Done", self.save_all, accent=True).pack(side=tk.RIGHT)
        
        self.wait_window()
    
    def update_opacity(self, value):
        self.opacity_label.config(text=f"{int(float(value) * 100)}%")
        if self.keyboard:
            self.keyboard.set_opacity(value)
    
    def choose_color(self):
        from tkinter.colorchooser import askcolor
        color = askcolor(color=self.accent_color, title="Choose Accent Color")
        if color[1]:
            self.accent_color = color[1]
            self.color_preview.config(bg=self.accent_color)
    
    def update_width(self, value):
        self.width_label.config(text=f"{int(float(value))}")
        self.keyboard_width = int(float(value))
    
    def create_button(self, parent, text, command, accent=False, success=False, danger=False):
        if accent:
            bg, hover = COLORS['accent'], COLORS['accent_hover']
        elif success:
            bg, hover = COLORS['success'], COLORS['success_hover']
        elif danger:
            bg, hover = COLORS['bg_light'], COLORS['danger']
        else:
            bg, hover = COLORS['bg_light'], COLORS['key_hover']
        
        btn = tk.Button(parent, text=text, font=('Segoe UI', 10),
                       bg=bg, fg=COLORS['text'], activebackground=hover,
                       activeforeground=COLORS['text'], relief='flat',
                       padx=16, pady=6, cursor='hand2', command=command, highlightthickness=0)
        btn.bind('<Enter>', lambda e: btn.configure(bg=hover))
        btn.bind('<Leave>', lambda e: btn.configure(bg=bg))
        return btn
    
    def refresh_list(self):
        self.listbox.delete(0, tk.END)
        for key in self.custom_keys:
            icon = "📝" if key.get('type') == 'word' else "⌨️"
            content = f'"{key["word"]}"' if key.get('type') == 'word' else ' + '.join(key.get('keys', []))
            self.listbox.insert(tk.END, f"  {icon}  {key['name']}  →  {content}")
    
    def add_key(self):
        dialog = CustomKeyDialog(self)
        if dialog.result:
            self.custom_keys.append(dialog.result)
            self.refresh_list()
    
    def edit_key(self):
        sel = self.listbox.curselection()
        if not sel:
            return
        dialog = CustomKeyDialog(self, self.custom_keys[sel[0]])
        if dialog.result:
            self.custom_keys[sel[0]] = dialog.result
            self.refresh_list()
    
    def delete_key(self):
        sel = self.listbox.curselection()
        if sel and messagebox.askyesno("Delete", f"Remove '{self.custom_keys[sel[0]]['name']}'?"):
            del self.custom_keys[sel[0]]
            self.refresh_list()
    
    def save_all(self):
        self.result = (self.custom_keys, self.accent_color, self.keyboard_width)
        self.destroy()


class OnScreenKeyboard:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Keyboard")
        self.root.configure(bg=COLORS['bg_dark'])
        
        self.root.attributes('-topmost', True)
        self.root.attributes('-type', 'dock')
        self.root.resizable(True, True)
        
        self.shift_active = False
        self.caps_lock = False
        self.ctrl_active = False
        self.alt_active = False
        self.fn_active = False
        self.minimized = False
        self.accent_color = COLORS['accent']
        self.keyboard_width = 15
        
        # Word suggestions
        self.current_word = ""
        self.common_words = ['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 
                           'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 
                           'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
                           'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make',
                           'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your',
                           'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come']
        
        self.custom_keys = self.load_custom_keys()
        self.load_settings()
        
        self.keyboard_layouts = {
            'normal': [
                ['Esc', '`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Bksp'],
                ['Tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\', 'Del'],
                ['Caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'Enter', '↑'],
                ['Shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'Shift', '←', '↓', '→'],
                ['Fn', 'Ctrl', 'Win', 'Alt', 'Space', 'Alt', 'Ctrl', '−', '⚙']
            ],
            'shift': [
                ['Esc', '~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', 'Bksp'],
                ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '{', '}', '|', 'Del'],
                ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ':', '"', 'Enter', '↑'],
                ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '<', '>', '?', 'Shift', '←', '↓', '→'],
                ['Fn', 'Ctrl', 'Win', 'Alt', 'Space', 'Alt', 'Ctrl', '−', '⚙']
            ],
            'fn': [
                ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Ins', 'PrtSc', 'Bksp'],
                ['Tab', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '{', 'Del'],
                ['Caps', '}', '|', ':', '"', '<', '>', '?', '~', '`', 'Home', 'End', 'Enter', 'PgUp'],
                ['Shift', 'Vol-', 'Vol+', 'Mute', 'Prev', 'Play', 'Next', 'Br-', 'Br+', 'ScrLk', 'Pause', 'Shift', 'PgDn'],
                ['Fn', 'Ctrl', 'Win', 'Alt', 'Space', 'Alt', 'Ctrl', '−', '⚙']
            ]
        }
        
        self.outer_frame = tk.Frame(self.root, bg=COLORS['shadow'], padx=3, pady=3)
        self.outer_frame.pack(fill=tk.BOTH, expand=True)
        
        # Word suggestions frame with border and toggle
        self.suggestions_docked = True
        
        # Toggle button frame (always visible)
        self.toggle_frame = tk.Frame(self.outer_frame, bg=COLORS['bg_medium'], padx=12, pady=8)
        self.toggle_frame.pack(fill=tk.X)
        
        self.suggestions_label = tk.Label(self.toggle_frame, text="💡 Suggestions:", 
                                         font=('Segoe UI', 8, 'bold'), bg=COLORS['bg_medium'], 
                                         fg=COLORS['text_dim'], anchor=tk.W)
        self.suggestions_label.pack(anchor=tk.W, side=tk.LEFT, expand=True)
        
        self.toggle_suggestions_btn = tk.Button(self.toggle_frame, text="▼", font=('Segoe UI', 8, 'bold'),
                                               bg=COLORS['bg_medium'], fg=COLORS['text_dim'],
                                               activebackground=COLORS['bg_light'], activeforeground=COLORS['text'],
                                               relief='flat', cursor='hand2', highlightthickness=0, padx=5,
                                               command=self.toggle_suggestions)
        self.toggle_suggestions_btn.pack(side=tk.RIGHT)
        
        # Suggestions frame (collapsible)
        self.suggestions_frame = tk.Frame(self.outer_frame, bg=COLORS['bg_medium'], padx=12, pady=10)
        self.suggestions_frame.pack(fill=tk.X)
        
        self.suggestions_text = tk.Label(self.suggestions_frame, text="", 
                                        font=('Segoe UI', 10, 'bold'), bg=COLORS['bg_medium'], 
                                        fg=self.accent_color, wraplength=500, justify=tk.LEFT, anchor=tk.W)
        self.suggestions_text.pack(anchor=tk.W)
        
        # Suggestion debounce
        self.suggestion_timer = None
        self.last_suggestion_word = ""
        
        self.main_frame = tk.Frame(self.outer_frame, bg=COLORS['bg_dark'], padx=10, pady=10)
        self.main_frame.pack(fill=tk.BOTH, expand=True)
        
        self.buttons = {}
        self.custom_buttons_frame = None
        self.minimized = False
        self.opacity = 0.95
        self.minimize_btn = None
        
        # Create collapse button frame (initially hidden)
        self.collapse_frame = tk.Frame(self.root, bg=COLORS['bg_dark'], padx=3, pady=3)
        self.collapse_frame.pack_forget()
        
        collapse_btn_container = tk.Frame(self.collapse_frame, bg=COLORS['bg_dark'])
        collapse_btn_container.pack()
        
        self.collapse_btn = tk.Button(collapse_btn_container, text='+', font=('Segoe UI', 16, 'bold'),
                                      width=2, height=1, bg=self.accent_color, fg=COLORS['text'],
                                      activebackground=COLORS['accent_hover'], activeforeground=COLORS['text'],
                                      relief='flat', cursor='hand2', highlightthickness=0, pady=5, padx=5,
                                      command=self.minimize_keyboard)
        self.collapse_btn.pack(side=tk.LEFT, padx=2, pady=2)
        
        close_btn = tk.Button(collapse_btn_container, text='✕', font=('Segoe UI', 14, 'bold'),
                             width=1, height=1, bg=COLORS['danger'], fg=COLORS['text'],
                             activebackground=COLORS['accent_hover'], activeforeground=COLORS['text'],
                             relief='flat', cursor='hand2', highlightthickness=0, pady=5, padx=3,
                             command=self.root.quit)
        close_btn.pack(side=tk.LEFT, padx=2, pady=2)
        
        self.create_keyboard()
        self.create_custom_keys_row()
        
        self.setup_dragging()
        self.position_window()
        self.root.attributes('-alpha', self.opacity)
    
    def position_window(self):
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        ww = self.root.winfo_width()
        wh = self.root.winfo_height()
        self.root.geometry(f"+{(sw-ww)//2}+{sh-wh-40}")
    
    def setup_dragging(self):
        self.drag_data = {'x': 0, 'y': 0}
        # Dragging for keyboard layout
        self.outer_frame.bind('<Button-1>', self.start_drag)
        self.outer_frame.bind('<B1-Motion>', self.on_drag)
        # Dragging for collapse frame
        self.collapse_frame.bind('<Button-1>', self.start_drag)
        self.collapse_frame.bind('<B1-Motion>', self.on_drag)
        # Make buttons exclude dragging
        self.drag_exclude = set()
    
    def start_drag(self, event):
        self.drag_data['x'] = event.x
        self.drag_data['y'] = event.y
    
    def on_drag(self, event):
        x = self.root.winfo_x() + (event.x - self.drag_data['x'])
        y = self.root.winfo_y() + (event.y - self.drag_data['y'])
        self.root.geometry(f"+{x}+{y}")
    
    def toggle_suggestions(self):
        """Toggle suggestions frame visibility"""
        self.suggestions_docked = not self.suggestions_docked
        if self.suggestions_docked:
            # Show suggestions frame
            self.suggestions_frame.pack(fill=tk.X)
            self.toggle_suggestions_btn.config(text="▼")
        else:
            # Hide suggestions frame (but keep toggle button visible)
            self.suggestions_frame.pack_forget()
            self.toggle_suggestions_btn.config(text="▲")
    
    def minimize_keyboard(self):
        if self.minimized:
            # Restore full keyboard
            self.collapse_frame.pack_forget()
            self.outer_frame.pack()
            self.minimized = False
            self.position_window()
        else:
            # Collapse to just restore button
            self.outer_frame.pack_forget()
            self.collapse_frame.pack()
            self.minimized = True
        self.root.update_idletasks()
    
    def set_opacity(self, value):
        self.opacity = float(value)
        self.root.attributes('-alpha', self.opacity)
    
    def load_custom_keys(self):
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r') as f:
                    return json.load(f)
        except Exception as e:
            print(f"Warning: Could not load custom keys: {e}")
        return []
    
    def load_settings(self):
        try:
            settings_file = os.path.expanduser("~/.osk_settings.json")
            if os.path.exists(settings_file):
                with open(settings_file, 'r') as f:
                    settings = json.load(f)
                    self.accent_color = settings.get('accent_color', COLORS['accent'])
                    self.keyboard_width = settings.get('keyboard_width', 15)
        except Exception as e:
            print(f"Warning: Could not load settings: {e}")
    
    def save_settings(self):
        try:
            settings_file = os.path.expanduser("~/.osk_settings.json")
            settings = {'accent_color': self.accent_color, 'keyboard_width': self.keyboard_width}
            with open(settings_file, 'w') as f:
                json.dump(settings, f, indent=2)
        except Exception as e:
            print(f"Warning: Could not save settings: {e}")
    
    def save_custom_keys(self):
        try:
            with open(CONFIG_FILE, 'w') as f:
                json.dump(self.custom_keys, f, indent=2)
        except Exception as e:
            print(f"Warning: Could not save custom keys: {e}")
    
    def create_keyboard(self):
        layout = self.get_current_layout()
        
        for row_idx, row in enumerate(layout):
            row_frame = tk.Frame(self.main_frame, bg=COLORS['bg_dark'])
            row_frame.pack(pady=2)
            
            for key in row:
                btn = self.create_key_button(row_frame, key, row_idx)
                btn.pack(side=tk.LEFT, padx=2)
    
    def recreate_keyboard(self):
        """Destroy and recreate keyboard when settings change"""
        if hasattr(self, 'main_frame') and self.main_frame.winfo_exists():
            self.main_frame.destroy()
        self.buttons = {}
        self.main_frame = tk.Frame(self.outer_frame, bg=COLORS['bg_dark'], padx=10, pady=10)
        self.main_frame.pack(fill=tk.BOTH, expand=True)
        self.create_keyboard()
        self.create_custom_keys_row()
        # Update collapse button color
        if self.collapse_btn:
            self.collapse_btn.config(bg=self.accent_color)
        # Update suggestions text color
        if self.suggestions_text:
            self.suggestions_text.config(fg=self.accent_color)
        # Re-setup dragging for new buttons
        self.setup_dragging()
        self.root.update_idletasks()
    
    def create_key_button(self, parent, key, row_idx):
        is_modifier = key in ['Shift', 'Caps', 'Ctrl', 'Alt', 'Fn']
        is_settings = key == '⚙'
        is_minimize = key == '−'
        display = self.get_display_text(key)
        width = self.get_key_width(key)
        
        container = tk.Frame(parent, bg=COLORS['bg_dark'])
        
        if is_settings or is_minimize:
            bg = self.accent_color
            try:
                r = int(self.accent_color[1:3], 16)
                g = int(self.accent_color[3:5], 16)
                b = int(self.accent_color[5:7], 16)
                hover = '#{:02x}{:02x}{:02x}'.format(min(r+50, 255), min(g+50, 255), min(b+50, 255))
            except:
                hover = COLORS['accent_hover']
        elif is_modifier:
            bg = COLORS['bg_light']
            hover = COLORS['key_hover']
        else:
            bg = COLORS['key_bg']
            hover = COLORS['key_hover']
        
        btn = tk.Button(container, text=display, font=('Segoe UI', 11 if len(display) <= 2 else 9, 'bold'),
                       width=width, height=1, bg=bg, fg=COLORS['text'],
                       activebackground=COLORS['key_press'], activeforeground=COLORS['text'],
                       relief='raised', cursor='hand2', highlightthickness=1, highlightbackground=COLORS['border'],
                       highlightcolor=COLORS['accent_light'], pady=10, bd=1)
        
        def enter(e):
            if not (is_modifier and self.is_active(key)):
                btn.configure(bg=hover)
        
        def leave(e):
            if is_modifier and self.is_active(key):
                btn.configure(bg=COLORS['modifier_active'])
            elif is_settings or is_minimize:
                btn.configure(bg=self.accent_color)
            else:
                btn.configure(bg=COLORS['key_bg'] if not is_modifier else COLORS['bg_light'])
        
        btn.bind('<Enter>', enter)
        btn.bind('<Leave>', leave)
        btn.configure(command=lambda k=key: self.on_key_click(k))
        btn.pack(fill=tk.BOTH, expand=True)
        
        self.buttons[f"{row_idx}_{key}"] = btn
        return container
    
    def is_active(self, key):
        return {'Shift': self.shift_active, 'Caps': self.caps_lock,
                'Ctrl': self.ctrl_active, 'Alt': self.alt_active, 'Fn': self.fn_active}.get(key, False)
    
    def create_custom_keys_row(self):
        if self.custom_buttons_frame:
            self.custom_buttons_frame.destroy()
        if not self.custom_keys:
            return
        
        self.custom_buttons_frame = tk.Frame(self.main_frame, bg=COLORS['bg_dark'])
        self.custom_buttons_frame.pack(pady=(10, 0))
        
        for ck in self.custom_keys:
            is_word = ck.get('type') == 'word'
            icon = "📝" if is_word else "⌨️"
            name = ck['name'][:12]
            
            btn = tk.Button(self.custom_buttons_frame, text=f"{icon} {name}",
                           font=('Segoe UI', 9, 'bold'), bg=self.accent_color, fg=COLORS['text'],
                           activebackground=COLORS['custom_hover'], activeforeground=COLORS['text'],
                           relief='flat', padx=14, pady=6, cursor='hand2', highlightthickness=0,
                           command=lambda k=ck: self.send_custom_key(k))
            btn.pack(side=tk.LEFT, padx=4)
            def create_hover_handler(button, original_color):
                def on_enter(e):
                    try:
                        r = int(original_color[1:3], 16)
                        g = int(original_color[3:5], 16)
                        b = int(original_color[5:7], 16)
                        hover = '#{:02x}{:02x}{:02x}'.format(min(r+50, 255), min(g+50, 255), min(b+50, 255))
                    except:
                        hover = COLORS['custom_hover']
                    button.configure(bg=hover)
                def on_leave(e):
                    button.configure(bg=original_color)
                return on_enter, on_leave
            
            on_enter, on_leave = create_hover_handler(btn, self.accent_color)
            btn.bind('<Enter>', on_enter)
            btn.bind('<Leave>', on_leave)
    
    def open_settings(self):
        dialog = SettingsDialog(self.root, self.custom_keys, keyboard=self)
        if dialog.result is not None:
            self.custom_keys = dialog.result[0]
            self.accent_color = dialog.result[1]
            self.keyboard_width = dialog.result[2]
            self.save_custom_keys()
            self.save_settings()
            self.recreate_keyboard()
    
    def send_custom_key(self, ck):
        try:
            if ck.get('type') == 'word':
                subprocess.run(['xdotool', 'type', '--clearmodifiers', ck['word']], check=True)
            else:
                trans = {'Ctrl': 'ctrl', 'Alt': 'alt', 'Shift': 'shift', 'Super': 'super',
                        'Space': 'space', 'Enter': 'Return', 'Tab': 'Tab', 'Escape': 'Escape',
                        'BackSpace': 'BackSpace', 'Delete': 'Delete'}
                keys = [trans.get(k, k) for k in ck.get('keys', [])]
                subprocess.run(['xdotool', 'key', '+'.join(keys)], check=True)
        except FileNotFoundError:
            print("Error: xdotool is not installed. Please install it to send keystrokes.")
        except Exception as e:
            print(f"Error sending custom key: {e}")
    
    def get_display_text(self, key):
        return {'Bksp': '⌫', 'Tab': '⇥', 'Enter': '↵', 'Space': '', 'Caps': '⇪', 'Shift': '⇧',
                'Del': '⌦', 'Esc': '⎋', 'Win': '⊞', '−': '−'}.get(key, key)
    
    def get_key_width(self, key):
        base_widths = {'Space': 20, 'Bksp': 5, 'Tab': 5, 'Caps': 6, 'Enter': 5, 'Shift': 7, 'Fn': 3, 'Ctrl': 4, 'Alt': 3, 
                       '⚙': 3, 'Win': 3, 'Del': 3, '−': 3, '↑': 3, '↓': 3, '←': 3, '→': 3}
        base_width = base_widths.get(key, 3)
        # Apply keyboard width scaling (15 is the default, 10-20 is the range)
        return max(1, int(base_width * self.keyboard_width / 15))
    
    def get_current_layout(self):
        if self.fn_active:
            return self.keyboard_layouts['fn']
        return self.keyboard_layouts['shift' if self.shift_active or self.caps_lock else 'normal']
    
    def update_labels(self):
        layout = self.get_current_layout()
        normal = self.keyboard_layouts['normal']
        for ri, row in enumerate(layout):
            for ci, key in enumerate(row):
                orig = normal[ri][ci]
                if f"{ri}_{orig}" in self.buttons:
                    self.buttons[f"{ri}_{orig}"].configure(text=self.get_display_text(key))
    
    def on_key_click(self, key):
        if key == 'Shift':
            self.shift_active = not self.shift_active
        elif key == 'Caps':
            self.caps_lock = not self.caps_lock
        elif key == 'Ctrl':
            self.ctrl_active = not self.ctrl_active
        elif key == 'Alt':
            self.alt_active = not self.alt_active
        elif key == 'Fn':
            self.fn_active = not self.fn_active
        elif key == '−':
            self.minimize_keyboard()
            return
        elif key == '⚙':
            self.open_settings()
            return
        else:
            self.send_keystroke(key)
            self.update_word_suggestions(key)
            if self.shift_active:
                self.shift_active = False
            if self.ctrl_active:
                self.ctrl_active = False
            if self.alt_active:
                self.alt_active = False
            if self.fn_active:
                self.fn_active = False
        
        self.update_modifiers()
        self.update_labels()
    
    def update_modifiers(self):
        states = {'Shift': self.shift_active, 'Caps': self.caps_lock, 'Ctrl': self.ctrl_active, 'Alt': self.alt_active, 'Fn': self.fn_active}
        for k, btn in self.buttons.items():
            key = k.split('_', 1)[1]
            if key in states:
                btn.configure(bg=COLORS['modifier_active'] if states[key] else COLORS['bg_light'])
    
    def update_word_suggestions(self, key):
        """Update suggestions based on typed characters with debouncing"""
        if key == 'Space':
            self.current_word = ""
        elif key == 'Bksp':
            self.current_word = self.current_word[:-1]
        elif key == 'Enter':
            self.current_word = ""
        elif len(key) == 1 and key.isalpha():
            self.current_word += key.lower()
        else:
            return
        
        # Cancel previous timer
        if self.suggestion_timer:
            self.root.after_cancel(self.suggestion_timer)
        
        # Debounce suggestions update (50ms delay for smoother experience)
        self.suggestion_timer = self.root.after(50, self.render_suggestions)
    
    def render_suggestions(self):
        """Render word suggestions"""
        if not self.suggestions_docked:
            self.suggestion_timer = None
            return
        
        suggestions = []
        if self.current_word and len(self.current_word) >= 1:
            suggestions = [w for w in self.common_words if w.startswith(self.current_word)][:6]
        
        # Format suggestions with better display
        if suggestions:
            # Show count and suggestions
            display = " · ".join(suggestions)
            self.suggestions_text.config(text=display)
        else:
            self.suggestions_text.config(text="")
        
        self.suggestion_timer = None
    
    def send_keystroke(self, key):
        keymap = {'Space': 'space', 'Bksp': 'BackSpace', 'Enter': 'Return', 'Tab': 'Tab',
                  'Del': 'Delete', 'Esc': 'Escape', 'Win': 'Super_L',
                  '↑': 'Up', '↓': 'Down', '←': 'Left', '→': 'Right'}
        specials = {'~': 'asciitilde', '!': 'exclam', '@': 'at', '#': 'numbersign', '$': 'dollar',
                   '%': 'percent', '^': 'asciicircum', '&': 'ampersand', '*': 'asterisk',
                   '(': 'parenleft', ')': 'parenright', '_': 'underscore', '+': 'plus',
                   '{': 'braceleft', '}': 'braceright', '|': 'bar', ':': 'colon', '"': 'quotedbl',
                   '<': 'less', '>': 'greater', '?': 'question', '`': 'grave', '-': 'minus',
                   '=': 'equal', '[': 'bracketleft', ']': 'bracketright', '\\': 'backslash',
                   ';': 'semicolon', "'": 'apostrophe', ',': 'comma', '.': 'period', '/': 'slash'}
        
        xkey = keymap.get(key) or specials.get(key) or key
        mods = []
        if self.ctrl_active:
            mods.append('ctrl')
        if self.alt_active:
            mods.append('alt')
        
        try:
            if len(key) == 1 and key.isalnum() and not mods:
                subprocess.run(['xdotool', 'type', '--clearmodifiers', key], check=True)
            else:
                subprocess.run(['xdotool', 'key', '+'.join(mods + [xkey]) if mods else xkey], check=True)
        except FileNotFoundError:
            print("Error: xdotool is not installed. Please install it to send keystrokes.")
        except Exception as e:
            print(f"Error sending keystroke: {e}")
    
    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    OnScreenKeyboard().run()
