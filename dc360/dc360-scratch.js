/* Scratch on DC360: the ONE DC360 menu bar, Save to DC360, My Work, Current file, the Help menu and no uploads, the
   same as the other DC360 apps. Added by the Libraries app updater (recipe scratch), so it comes back after every
   Scratch update.

   It works through Scratch's own engine (the VM, found through React), so nothing in Scratch's code needs changing:
   - Save:  vm.saveProjectSb3() (the .sb3 file) plus a picture of the stage (vm.renderer.requestSnapshot), sent to
            com_dc360scratch. The server leaves out Scratch library costumes and sounds (DC360 keeps one copy).
   - Open:  com_dc360scratch project.load gives the whole .sb3 back; vm.loadProject() opens it.
   - Menu bar: the DC360 bar (File, Edit, Insert, View, Arrange, My Work, Help) replaces Scratch's File and Edit menus
            (see "the ONE DC360 menu bar" below). Outside DC360, Scratch's File menu gets "Save to DC360" and "My Work"
            and loses "Load from your computer" (no uploads).
   - No uploads: every way of choosing a file from the computer (Upload Sprite / Costume / Backdrop / Sound, Load from
     your computer, dropping a file) is blocked. Students draw, record, or use the Scratch library.
   ?open=<id> on the DC360 page's address (My Work's Open, a teacher's Edit) opens that project.
   Refresh keeps the project (only for the same DC360 login): see "refresh keeps the project" below.
   All text from the server goes in via textContent. */
(function (w, d) {
    'use strict';

    var api = w.location.origin + '/index.php?option=com_dc360scratch&task=';
    var token = '';
    var current = null; /* { id, title, ownerName, isOwner } */
    var dirty = false;
    var opening = 0;
    var vm = null;
    var store = null;
    var NO_UPLOADS = 'On DC360, Scratch cannot open files from your computer. Draw your own costumes, record sounds, or choose from the Scratch library. Open your saved projects with My Work.';

    function el(tag, cls, text) {
        var n = d.createElement(tag);
        if (cls) { n.className = cls; }
        if (text !== undefined && text !== null) { n.textContent = text; }
        return n;
    }

    function shared() {
        try {
            var s = w.dc360Say || (w.parent && w.parent.dc360Say);
            return s && typeof s.save === 'function' && typeof s.myWork === 'function' ? s : null;
        } catch (e) { return null; }
    }

    function say(msg, isError) {
        var s = shared();
        if (s && s.alert && isError) { s.alert(msg); return; }
        toast(msg, isError);
    }

    function toast(msg, isError, ms) {
        var t = el('div', 'dc360-sc-toast' + (isError ? ' is-error' : ''), msg);
        d.body.appendChild(t);
        setTimeout(function () { t.classList.add('is-going'); }, (ms || (isError ? 5000 : 2600)) - 300);
        setTimeout(function () { t.remove(); }, ms || (isError ? 5000 : 2600));
    }

    function post(task, data, raw) {
        var body = new FormData();
        body.append(token, '1');
        Object.keys(data || {}).forEach(function (k) {
            var v = data[k];
            if (v instanceof Blob) { body.append(k, v, k + (v.type === 'image/webp' ? '.webp' : v.type === 'image/png' ? '.png' : '.sb3')); }
            else { body.append(k, v); }
        });
        return fetch(api + task, { method: 'POST', body: body, credentials: 'same-origin' }).then(function (r) {
            if (raw) {
                if (!r.ok) { throw new Error('This project could not be opened.'); }
                return r.arrayBuffer();
            }
            return r.json().catch(function () { return { ok: false }; }).then(function (j) {
                if (!j || !j.ok) { throw new Error((j && j.error) || 'Something went wrong. Please try again.'); }
                return j;
            });
        });
    }

    function formatDate(sql) {
        var x = new Date(String(sql || '').replace(' ', 'T') + 'Z');
        return isNaN(x.getTime()) ? '' : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }

    /* ---------- Scratch's engine and store (through React) ---------- */

    function fiberOf(node) {
        if (!node) { return null; }
        var k = Object.keys(node).find(function (x) { return x.indexOf('__reactFiber') === 0 || x.indexOf('__reactInternalInstance') === 0; });
        return k ? node[k] : null;
    }

    function find(test) {
        var f = fiberOf(d.querySelector('[class*="gui_page-wrapper"], [class*="gui_body-wrapper"], [class*="menu-bar_menu-bar"]'));
        for (var i = 0; f && i < 200; i++, f = f.return) {
            var p = f.memoizedProps;
            if (p) { var hit = test(p); if (hit) { return hit; } }
        }
        return null;
    }

    function engine() {
        if (!vm) { vm = find(function (p) { return p.vm && p.vm.runtime && p.vm.saveProjectSb3 ? p.vm : null; }); }
        return vm;
    }

    function reduxStore() {
        if (!store) { store = find(function (p) { return p.store && p.store.getState && p.store.dispatch ? p.store : null; }); }
        return store;
    }

    /* Scratch's own project title (used for "Save to your computer"), kept the same as the DC360 title. */
    function setScratchTitle(title) {
        var s = reduxStore();
        try { if (s) { s.dispatch({ type: 'projectTitle/SET_PROJECT_TITLE', title: title || '' }); } } catch (e) { /* only the download name */ }
    }

    /* ---------- the picture of the stage ---------- */

    function snapshot() {
        var v = engine();
        return new Promise(function (resolve, reject) {
            if (!v || !v.renderer || !v.renderer.requestSnapshot) { reject(new Error('Scratch is still starting. Please try again.')); return; }
            v.renderer.requestSnapshot(function (url) {
                var img = new Image();
                img.onload = function () { resolve(img); };
                img.onerror = function () { reject(new Error('The picture of the stage could not be made.')); };
                img.src = url;
            });
        });
    }

    function shrink(img, width) {
        var c = d.createElement('canvas');
        c.width = width;
        c.height = Math.round(width * 3 / 4);
        var g = c.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        return new Promise(function (resolve, reject) {
            c.toBlob(function (b) {
                if (b && b.type === 'image/webp') { resolve(b); return; }
                c.toBlob(function (p) { p ? resolve(p) : reject(new Error('The picture of the stage could not be made.')); }, 'image/png');
            }, 'image/webp', 0.82);
        });
    }

    /* ---------- current file ---------- */

    function setCurrent(c) { current = c; showCurrent(); }

    function showCurrent() {
        laterDraft(); // the Current file or (saved)/(unsaved) changed: the copy kept for a refresh follows
        var item = d.getElementById('dc360_sc_current');
        if (!item) { return; }
        var theirs = current && current.isOwner === false;
        item.textContent = '';
        item.appendChild(el('span', 'dc360-sc-cur-label', theirs ? 'Editing ' + current.ownerName + '’s work:' : 'Current file:'));
        item.appendChild(current ? el('span', 'dc360-sc-cur-name', current.title) : el('span', 'dc360-sc-cur-none', 'Not saved yet'));
        /* (saved) / (unsaved) after the title: the DC360 standard in every app (2026-10-17). */
        if (current) { item.appendChild(el('span', 'dc360-cur-state' + (dirty ? ' is-unsaved' : ''), dirty ? '(unsaved)' : '(saved)')); }
        item.title = theirs ? 'You are editing ' + current.ownerName + '’s "' + current.title + '". Click to save your changes into their work.'
            : current ? 'You are working on "' + current.title + '". Click to save it to DC360.' : 'This project is not saved to DC360 yet. Click to save it.';
    }

    function changed() { if (opening) { return; } if (!dirty) { dirty = true; showCurrent(); } }

    /* ---------- saving ---------- */

    function save(id, title) {
        var v = engine();
        if (!v) { return Promise.reject(new Error('Scratch is still starting. Please try again.')); }
        return Promise.all([v.saveProjectSb3(), snapshot()]).then(function (r) {
            return Promise.all([shrink(r[1], 480), shrink(r[1], 240)]).then(function (pics) {
                return post('project.save', { id: id || 0, title: title, sb3: new Blob([r[0]], { type: 'application/x.scratch.sb3' }), image: pics[0], thumb: pics[1] });
            });
        }).then(function (j) {
            var keep = current && id && current.id === j.id ? current : null;
            dirty = false;
            setCurrent({ id: j.id, title: title, ownerName: keep ? keep.ownerName : '', isOwner: keep ? keep.isOwner : true });
            setScratchTitle(title);
            toast(keep && keep.isOwner === false ? 'Saved your changes into ' + keep.ownerName + '’s work: ' + title : 'Saved to DC360: ' + title);
        });
    }

    function needLogin() {
        if (token) { return false; }
        say('Please log in to DC360 to save your Scratch projects and see My Work.', true);
        return true;
    }

    function openSave() {
        if (needLogin()) { return; }
        var s = shared();
        if (!s) { say('Save to DC360 works when Scratch is used inside DC360.', true); return; }
        s.save({
            app: 'Scratch', noun: 'project', current: current, placeholder: 'e.g. My maze game', title: current ? current.title : '',
            hint: 'Your Scratch project is saved to your DC360 profile, where your teacher can play it and leave comments.',
            onSave: function (c) { return save(c.asNew ? 0 : (current ? current.id : 0), c.title); }
        });
    }

    function quickSave() {
        if (needLogin()) { return; }
        if (!current) { openSave(); return; }
        toast('Saving…');
        save(current.id, current.title).catch(function (e) { say(e.message, true); });
    }

    /* ---------- opening ---------- */

    function openProject(id, title, info) {
        var v = engine();
        if (!v) { return Promise.reject(new Error('Scratch is still starting. Please try again.')); }
        opening++;
        return post('project.load', { id: id }, true).then(function (buf) {
            return v.loadProject(buf);
        }).then(function () {
            setScratchTitle(title);
            setCurrent({ id: id, title: title, ownerName: info ? info.ownerName : '', isOwner: info ? info.isOwner !== false : true });
            setTimeout(function () { opening = Math.max(0, opening - 1); dirty = false; showCurrent(); }, 1200);
        }, function (e) { opening = Math.max(0, opening - 1); throw e; });
    }

    function openFromAddress() {
        var host = w;
        try { if (w.parent !== w && w.parent.location.search) { host = w.parent; } } catch (e) { host = w; }
        var match = /[?&]open=(\d{1,10})(?:&|$)/.exec(host.location.search || '');
        if (!match) { return; }
        var id = parseInt(match[1], 10);
        try { var url = new URL(host.location.href); url.searchParams.delete('open'); host.history.replaceState(null, '', url.toString()); } catch (e) { /* harmless */ }
        post('project.info', { id: id }).then(function (it) {
            return openProject(it.id, it.title, it).then(function () {
                toast(it.isOwner ? 'Opened: ' + it.title : 'Opened ' + it.ownerName + '’s project: ' + it.title + '. Update saves your changes into their work.', false, it.isOwner ? 0 : 7000);
            });
        }).catch(function () { say('That project could not be opened. Use My Work to find it.', true); });
    }

    /* ---------- My Work ---------- */

    function openWork() {
        if (needLogin()) { return; }
        var s = shared();
        if (!s) { say('My Work opens when Scratch is used inside DC360.', true); return; }
        s.myWork({
            app: 'Scratch', noun: 'project', icon: '🐱', currentId: current ? current.id : 0, trashUrl: '/my-trash?app=scratch',
            emptyText: 'You have not saved any Scratch projects yet. Use File > Save to DC360 to save your work.',
            load: function () { return post('project.list', {}).then(function (j) { return j.items || []; }); },
            meta: function (it) { return 'Saved ' + formatDate(it.modified) + ' · ' + it.sprites + (it.sprites === 1 ? ' sprite' : ' sprites') + (it.blocks ? ' · ' + it.blocks + ' blocks' : ''); },
            isDirty: function () { return dirty; },
            open: function (it) {
                return openProject(it.id, it.title, null).then(function () { toast('Opened: ' + it.title); }, function (e) { throw new Error(e.message || 'This project could not be opened.'); });
            },
            rename: function (it, title) {
                return post('project.rename', { id: it.id, title: title }).then(function (j) {
                    if (current && current.id === it.id) { current.title = j.title; showCurrent(); setScratchTitle(j.title); }
                    toast('Renamed to: ' + j.title);
                });
            },
            remove: function (it) {
                return post('project.delete', { id: it.id }).then(function () {
                    if (current && current.id === it.id) { setCurrent(null); }
                    toast('Moved to Trash. You can restore it from Trash for 60 days.', false, 6000);
                });
            },
            feedback: function (it) { showFeedback(it); }
        });
    }

    /* The teacher's marks and comments (the shared DC360 marking, com_dc360marking) in a DC360 box. */
    function showFeedback(it) {
        if (!w.Dc360Marking) { say('Feedback cannot be shown just now. Please try again later.', true); return; }
        var back = el('div', 'dc360-sc-modal-back');
        var box = el('div', 'dc360-sc-modal');
        var head = el('div', 'dc360-sc-modal-head');
        head.appendChild(el('strong', '', 'Feedback: ' + it.title));
        var close = el('button', 'dc360-sc-modal-close', 'Close');
        close.type = 'button';
        head.appendChild(close);
        var body = el('div', 'dc360-sc-modal-body');
        box.appendChild(head);
        box.appendChild(body);
        back.appendChild(box);
        d.body.appendChild(back);
        function done() { back.remove(); d.removeEventListener('keydown', esc, true); }
        function esc(e) { if (e.key === 'Escape') { done(); } }
        close.addEventListener('click', done);
        back.addEventListener('click', function (e) { if (e.target === back) { done(); } });
        d.addEventListener('keydown', esc, true);
        w.Dc360Marking.student(body, { app: 'scratch', itemId: it.id });
    }

    function loadMarking() {
        var v = '?v=' + Date.now().toString(36).slice(0, -4);
        var css = d.createElement('link');
        css.rel = 'stylesheet';
        css.href = w.location.origin + '/media/com_dc360marking/css/marking.css' + v;
        d.head.appendChild(css);
        var js = d.createElement('script');
        js.src = w.location.origin + '/media/com_dc360marking/js/marking.js' + v;
        js.defer = true;
        d.head.appendChild(js);
    }

    /* ---------- no uploads ---------- */

    (function blockUploads() {
        var click = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
            if (String(this.type).toLowerCase() === 'file') { say(NO_UPLOADS, true); return; }
            return click.apply(this, arguments);
        };
        if (w.showOpenFilePicker) {
            w.showOpenFilePicker = function () { say(NO_UPLOADS, true); return Promise.reject(new DOMException('Blocked on DC360', 'AbortError')); };
        }
        d.addEventListener('click', function (e) {
            var t = e.target;
            if (t && t.closest && t.closest('input[type="file"]')) { e.preventDefault(); e.stopPropagation(); say(NO_UPLOADS, true); }
        }, true);
        // DC360 server only: links to other websites (scratch.mit.edu help pages, the privacy policy) do not open.
        d.addEventListener('click', function (e) {
            var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
            if (!a) { return; }
            var url;
            try { url = new URL(a.getAttribute('href'), w.location.href); } catch (err) { return; }
            if (/^https?:$/.test(url.protocol) && url.origin !== w.location.origin) {
                e.preventDefault();
                e.stopPropagation();
                say('That link goes to another website, so it does not open on DC360.', true);
            }
        }, true);
        w.open = (function (open) {
            return function (url) {
                try { if (url && new URL(url, w.location.href).origin !== w.location.origin) { say('That link goes to another website, so it does not open on DC360.', true); return null; } } catch (e) { return null; }
                return open.apply(w, arguments);
            };
        })(w.open);
        ['dragover', 'drop'].forEach(function (type) {
            w.addEventListener(type, function (e) {
                var dt = e.dataTransfer;
                if (dt && Array.prototype.indexOf.call(dt.types || [], 'Files') !== -1) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (type === 'drop') { say(NO_UPLOADS, true); }
                }
            }, true);
        });
    })();

    /* ---------- the ONE DC360 menu bar (user 2026-10-22) ---------- */

    /*
     * The same menu bar as every DC360 app (dc360Say.menuBar from DC360 Help): the DC360 icon, File, Edit, Insert, View,
     * Arrange, My Work, Help, then "Current file:", then what is left of Scratch's own bar (its logo, Settings and
     * Debug: the owner decides later). Scratch's File and Edit menus are hidden: everything in them is in the DC360
     * menus. Scratch's bar is React, so the DC360 bar is put next to it (not inside its menus) and every item calls
     * Scratch itself: its engine (vm), its store (the same actions its own buttons send) and its code area (Blockly's
     * own Undo, Redo, Cut, Copy and Paste, the same as its keyboard shortcuts). On the Costumes and Sounds tabs, Edit
     * presses the paint and sound editors' own shortcut keys. Without DC360 Help (Scratch outside DC360), Scratch's
     * own File menu gets Save to DC360 and My Work instead (below).
     */
    var usingBar = false;

    function sayApi() {
        try {
            var s = w.dc360Say || (w.parent && w.parent.dc360Say);
            return s && typeof s.menuBar === 'function' ? s : null;
        } catch (e) { return null; }
    }

    function hint(msg) {
        var s = sayApi();
        if (s && s.hint) { try { s.hint(msg); return; } catch (e) { /* the note below */ } }
        toast(msg);
    }

    /* A React class component above a node of Scratch's page (e.g. its menu bar's own code, its code area's). */
    function instance(selector, test) {
        var f = fiberOf(d.querySelector(selector));
        for (var i = 0; f && i < 200; i++, f = f.return) {
            var s = f.stateNode;
            if (s && !s.nodeType && test(s)) { return s; }
        }
        return null;
    }

    function act(action) {
        var s = reduxStore();
        if (s) { s.dispatch(action); }
    }

    function gui() {
        var s = reduxStore();
        try { return s ? s.getState().scratchGui : null; } catch (e) { return null; }
    }

    /* 0 Code, 1 Costumes, 2 Sounds. */
    function activeTab() {
        var g = gui();
        return g && g.editorTab ? g.editorTab.activeTabIndex : 0;
    }

    function showTab(i) {
        if (activeTab() !== i) { act({ type: 'scratch-gui/navigation/ACTIVATE_TAB', activeTabIndex: i }); }
    }

    /* The code area: Scratch's Blocks (its workspace and its copy of Blockly). */
    function blocks() {
        var b = instance('[class*="blocks_blocks"]', function (s) { return s.workspace && s.ScratchBlocks; });
        return b ? { ws: b.workspace, sb: b.ScratchBlocks } : null;
    }

    /* A key sent to the page, as if typed (the paint and sound editors listen on the whole page). */
    function press(key, shift, target) {
        var one = key.length === 1;
        var ev = new w.KeyboardEvent('keydown', { key: key, code: one ? 'Key' + key.toUpperCase() : key, ctrlKey: one, shiftKey: !!shift,
            bubbles: true, cancelable: true });
        var kc = one ? key.toUpperCase().charCodeAt(0) : ({ Delete: 46 }[key] || 0);
        try {
            Object.defineProperty(ev, 'keyCode', { get: function () { return kc; } });
            Object.defineProperty(ev, 'which', { get: function () { return kc; } });
        } catch (e) { /* key is enough */ }
        (target || d.body).dispatchEvent(ev);
    }

    var KEYS = { undo: ['z', false], redo: ['Z', true], cut: ['x', false], copy: ['c', false], paste: ['v', false] };

    /* Blockly's own shortcut (the same thing Ctrl+C etc. do in the code area), on the block that was clicked. */
    function blockShortcut(cmd) {
        var b = blocks();
        if (!b) { return false; }
        if (cmd === 'undo' || cmd === 'redo') { b.ws.undo(cmd === 'redo'); return true; }
        try {
            var reg = b.sb.ShortcutRegistry && b.sb.ShortcutRegistry.registry;
            var item = reg ? reg.getRegistry()[cmd] : null;
            if (item) {
                var fm = b.sb.getFocusManager ? b.sb.getFocusManager() : null;
                var scope = { focusedNode: fm && fm.getFocusedNode ? fm.getFocusedNode() : null };
                var ev = new w.KeyboardEvent('keydown', { cancelable: true });
                if (item.preconditionFn && !item.preconditionFn(b.ws, scope)) { return false; }
                return item.callback(b.ws, ev, item, scope) !== false;
            }
        } catch (e) { /* the key below */ }
        var k = KEYS[cmd];
        press(k[0], k[1], d.querySelector('.injectionDiv'));
        return true;
    }

    /* Edit's five, on the text being typed if there is some, else on the tab showing (code, costume or sound). */
    function editDo(cmd) {
        var t = d.activeElement;
        if (t && (/^(input|textarea)$/i.test(t.tagName) || t.isContentEditable)) {
            if (cmd !== 'paste') { d.execCommand(cmd); return; }
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(function (txt) { t.focus(); d.execCommand('insertText', false, txt); },
                    function () { hint('Your browser did not allow pasting from the menu. Press Ctrl+V instead.'); });
            } else { hint('Press Ctrl+V to paste.'); }
            return;
        }
        var tab = activeTab();
        if (tab === 0) {
            if (!blockShortcut(cmd)) {
                hint(cmd === 'paste' ? 'Copy a block first (click it, then Edit > Copy), then choose Paste again.'
                    : 'Click a block in the code area first, then choose ' + cmd.charAt(0).toUpperCase() + cmd.slice(1) + ' again.');
            }
            return;
        }
        // The sound editor has no Cut key: copy, then delete what is chosen.
        if (tab === 2 && cmd === 'cut') { press('c'); press('Delete'); return; }
        press(KEYS[cmd][0], KEYS[cmd][1]);
    }

    /* File > New: Scratch's own new project, after a DC360 question if there is work that is not saved. */
    function newProject() {
        var bar = instance('[class*="menu-bar_menu-bar_"]', function (s) { return typeof s.handleClickNew === 'function'; });
        if (!bar || typeof bar.props.onClickNew !== 'function') { say('Scratch is still starting. Please try again.', true); return; }
        var g = gui();
        var risky = dirty || (!current && !!(g && g.projectChanged));
        var go = function (yes) {
            if (!yes) { return; }
            opening++;
            bar.props.onClickNew(!!(bar.props.canSave && bar.props.canCreateNew));
            setScratchTitle('');
            dirty = false;
            setCurrent(null);
            setTimeout(function () { opening = Math.max(0, opening - 1); dirty = false; showCurrent(); }, 1500);
        };
        if (!risky) { go(true); return; }
        var s = sayApi();
        var q = 'Start a new project? Anything not saved to DC360 will be lost.';
        if (s && s.confirm) { Promise.resolve(s.confirm(q)).then(go); } else { go(w.confirm(q)); }
    }

    /* File > Export: the project as a .sb3 file on this computer (Scratch's own "Save to your computer"). */
    function exportSb3() {
        var v = engine();
        if (!v) { say('Scratch is still starting. Please try again.', true); return; }
        v.saveProjectSb3().then(function (blob) {
            var a = d.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = String((current && current.title) || 'Scratch Project').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.sb3';
            d.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        }).catch(function () { say('Your project could not be exported. Please try again.', true); });
    }

    /* Insert: Scratch's own library boxes (DC360's own copy of the Scratch library), on the tab they belong to. */
    function library(modal, tab) {
        return function () {
            if (tab !== undefined) { showTab(tab); }
            setTimeout(function () { act({ type: 'scratch-gui/modals/OPEN_MODAL', modal: modal }); }, tab !== undefined ? 50 : 0);
        };
    }

    function costumeLibrary() {
        var v = engine();
        var stage = v && v.editingTarget && v.editingTarget.isStage;
        library(stage ? 'backdropLibrary' : 'costumeLibrary', 1)();
    }

    /* Restore: what Scratch's Edit > Restore brings back (the last sprite, costume or sound deleted). */
    function restoreFun() {
        var g = gui();
        return g && g.restoreDeletion && typeof g.restoreDeletion.restoreFun === 'function' ? g.restoreDeletion : null;
    }

    function restore() {
        var r = restoreFun();
        if (!r) { hint('There is nothing to restore.'); return; }
        r.restoreFun();
        act({ type: 'scratch-gui/restore-deletion/RESTORE_UPDATE', state: { restoreFun: null, deletedItem: '' } });
    }

    function turbo() {
        var v = engine();
        if (!v) { return; }
        v.setTurboMode(!v.runtime.turboMode);
        toast(v.runtime.turboMode ? 'Turbo Mode is on.' : 'Turbo Mode is off.');
    }

    /* View: the code area's zoom (Blockly's own, as its + / - / = buttons). */
    function zoom(step) {
        return function () {
            showTab(0);
            setTimeout(function () {
                var b = blocks();
                if (!b) { return; }
                if (step) { b.ws.zoomCenter(step); return; }
                b.ws.setScale(b.ws.options.zoomOptions.startScale);
                b.ws.scrollCenter();
            }, 50);
        };
    }

    function cleanUp() {
        showTab(0);
        setTimeout(function () { var b = blocks(); if (b) { b.ws.cleanUp(); } }, 50);
    }

    function scratchMenus() {
        return {
            file: [
                { label: 'New', title: 'Start a new, empty project (save this one first)', run: newProject },
                { label: 'Save to DC360', keys: 'Ctrl+S', title: 'Save this project to DC360, where your teacher can play it', run: quickOrSave, sep: true },
                { label: 'Save as new…', title: 'Save a separate copy with a new title', run: saveAsNew },
                { label: 'Export to my computer (.sb3)', title: 'Download this project as a Scratch file. This does not save it to DC360.', run: exportSb3, sep: true }
            ],
            edit: [
                { label: 'Undo', keys: 'Ctrl+Z', title: 'Undo the last change', run: function () { editDo('undo'); } },
                { label: 'Redo', keys: 'Ctrl+Shift+Z', title: 'Do it again', run: function () { editDo('redo'); } },
                { label: 'Cut', keys: 'Ctrl+X', title: 'Cut the chosen block (or picture, sound or text)', run: function () { editDo('cut'); } },
                { label: 'Copy', keys: 'Ctrl+C', title: 'Copy the chosen block (or picture, sound or text)', run: function () { editDo('copy'); } },
                { label: 'Paste', keys: 'Ctrl+V', title: 'Paste what you copied', run: function () { editDo('paste'); } },
                { label: 'Restore what I deleted', title: 'Bring back the sprite, costume or sound you deleted last', run: restore, when: function () { return !!restoreFun(); } },
                { label: 'Turbo Mode on / off', keys: 'Shift+click flag', title: 'Run the project as fast as it can go', run: turbo }
            ],
            insert: [
                { label: 'Sprite…', title: 'Choose a sprite from the Scratch library', run: library('spriteLibrary') },
                { label: 'Backdrop…', title: 'Choose a backdrop from the Scratch library', run: library('backdropLibrary') },
                { label: 'Costume…', title: 'Choose a costume for the chosen sprite (a backdrop for the stage)', run: costumeLibrary },
                { label: 'Sound…', title: 'Choose a sound from the Scratch library', run: library('soundLibrary', 2) },
                { label: 'Extension…', title: 'Add more blocks: Music, Pen, Video Sensing...', run: library('extensionLibrary', 0), sep: true }
            ],
            view: [
                { label: 'Full screen stage', title: 'Play the project on a big stage', run: function () { act({ type: 'scratch-gui/mode/SET_FULL_SCREEN', isFullScreen: true }); } },
                { label: 'Zoom in', keys: 'Ctrl+wheel', title: 'Make the code bigger', run: zoom(1), sep: true },
                { label: 'Zoom out', title: 'Make the code smaller', run: zoom(-1) },
                { label: 'Normal size', title: 'The code back to its usual size', run: zoom(0) }
            ],
            // The panel layout (stage size) is in Arrange in every app (owner 2026-10-22).
            arrange: [
                { label: 'Small stage', title: 'A smaller stage, more room for code', run: function () { act({ type: 'scratch-gui/StageSize/SET_STAGE_SIZE', stageSize: 'small' }); } },
                { label: 'Normal stage', title: 'The usual size of stage', run: function () { act({ type: 'scratch-gui/StageSize/SET_STAGE_SIZE', stageSize: 'large' }); } },
                { label: 'Clean up blocks', title: 'Line up all the code of this sprite down the left', run: cleanUp, sep: true }
            ]
        };
    }

    /* Scratch's own File and Edit menu buttons (found by what they do, so in every language): hidden, they are in the
       DC360 menus now. */
    function hideScratchMenus(group) {
        Array.prototype.forEach.call(group.children, function (n) {
            if (n.hasAttribute('data-dc360-moved')) { return; }
            var f = fiberOf(n);
            for (var i = 0; f && i < 4; i++, f = f.return) {
                var p = f.memoizedProps || {};
                if (p.getSaveToComputerHandler || p.onRestoreOption) { n.setAttribute('data-dc360-moved', ''); return; }
            }
        });
    }

    function addMenuBar(bar, cur) {
        var s = sayApi();
        var group = bar.querySelector('[class*="menu-bar_file-group"]');
        if (!s || !group) { return false; }
        try {
            var mb = s.menuBar({ app: 'scratch', at: group, where: 'before', menus: scratchMenus(), myWork: openWork });
            mb.bar.classList.add('dc360-sc-bar');
            mb.slot.appendChild(cur);
            hideScratchMenus(group);
            usingBar = true;
            return true;
        } catch (e) { return false; }
    }

    function menuItem(label, onClick, sample) {
        var li = el('li', sample ? sample.className : 'dc360-sc-menu-item');
        li.classList.add('dc360-sc-item');
        li.appendChild(el('span', '', label));
        li.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            // Close Scratch's menu (it closes when something outside it is clicked).
            d.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            d.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            setTimeout(onClick, 0);
        });
        return li;
    }

    /* Scratch's File menu (New, Load from your computer, Save to your computer): the only menu of three plain items.
       Found by its shape, not its words, so it works in every language. */
    function fixFileMenu(ul) {
        if (!ul || ul.querySelector('.dc360-sc-item')) { return; }
        var items = Array.prototype.filter.call(ul.children, function (n) { return n.tagName === 'LI'; });
        if (items.length !== 3 || items.some(function (n) { return n.querySelector('ul'); })) { return; }
        items[1].classList.add('dc360-sc-hidden');
        items[1].setAttribute('aria-hidden', 'true');
        ul.insertBefore(menuItem('Save to DC360', quickOrSave, items[0]), items[2]);
        ul.insertBefore(menuItem('My Work', openWork, items[0]), items[2]);
        ul.insertBefore(menuItem('Save as new…', saveAsNew, items[0]), items[2]);
    }

    function quickOrSave() { current ? quickSave() : openSave(); }
    function saveAsNew() { if (needLogin()) { return; } openSave(); }

    function addBar(bar) {
        if (!bar) { return; }
        if (d.getElementById('dc360_sc_current')) {
            // React drew Scratch's buttons again: its File and Edit stay hidden.
            if (usingBar) { var g = bar.querySelector('[class*="menu-bar_file-group"]'); if (g) { hideScratchMenus(g); } }
            return;
        }
        var group = bar.querySelector('[class*="menu-bar_file-group"]') || bar.firstElementChild;
        var cur = el('button', 'dc360-sc-current');
        cur.type = 'button';
        cur.id = 'dc360_sc_current';
        cur.addEventListener('click', quickOrSave);
        if (addMenuBar(bar, cur)) { showCurrent(); return; }
        // Without DC360 Help's menu bar: Help and Current file after Scratch's own menus.
        var help = el('div', (group.querySelector('[class*="menu-bar_menu-bar-item"]') || {}).className || 'dc360-sc-bar-item', '');
        help.classList.add('dc360-sc-help');
        help.appendChild(el('span', '', 'Help'));
        group.appendChild(help);
        group.appendChild(cur);
        var s = shared();
        if (s && s.helpMenu) { try { s.helpMenu(help, 'scratch'); } catch (e) { /* the Help tab still works */ } }
        showCurrent();
    }

    new MutationObserver(function () {
        var bar = d.querySelector('[class*="menu-bar_menu-bar_"]');
        if (bar) { addBar(bar); }
        if (!usingBar) { Array.prototype.forEach.call(d.querySelectorAll('[class*="menu-bar_menu-bar-menu"] ul, ul[class*="menu_menu_"]'), fixFileMenu); }
    }).observe(d.documentElement, { childList: true, subtree: true });

    /* ---------- refresh keeps the project ---------- */

    /*
     * Like DC360 Logic and Draw, pressing the browser's Refresh keeps the work: a copy of the project (the same .sb3
     * that Save to DC360 makes, vm.saveProjectSb3), its Current file and whether it is saved are kept in this browser
     * tab and never sent anywhere (no extra requests to DC360). The copy carries a mark made from the student's DC360
     * session token (from project.boot, fetched at start-up anyway), so it only comes back for the same login: after a
     * log out, or for anyone else, it is deleted, never opened.
     *  - A small project goes in this tab's session storage (gone when the tab is closed).
     *  - A big one (costumes, sounds) goes in IndexedDB, under this tab's own id, which only this tab's session
     *    storage knows. Every start-up deletes the copies of any other login, and any older than 12 hours; a start-up
     *    with nobody logged in deletes them all.
     *  - A project asked for in the address (?open=, My Work or a teacher's Edit) wins over the copy.
     * Scratch's own "Leave site?" warning is left as it is (it still protects work when the tab is closed).
     */
    var DRAFT_KEY = 'dc360scratch.draft';
    var DRAFT_DB = 'dc360scratch-draft';
    var DRAFT_SMALL = 750000;            // bytes of .sb3 kept in session storage (about 1 MB of text); more goes to IndexedDB
    var DRAFT_MAX_AGE = 12 * 3600 * 1000;
    var draftMark = '';
    var draftReady = false;
    var draftTimer = 0;
    var draftFirst = 0;
    var draftBusy = false;
    var draftAgain = false;
    var draftInDb = false;

    /* A mark made from the session token: the same token always gives the same mark, and the token itself is not kept. */
    function tokenMark(t) {
        var h1 = 0xdeadbeef, h2 = 0x41c6ce57, i, c;
        for (i = 0; i < t.length; i++) {
            c = t.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 2654435761);
            h2 = Math.imul(h2 ^ c, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return 'm' + (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36) + t.length.toString(36);
    }

    function ssGet(k) { try { return w.sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssDel(k) { try { w.sessionStorage.removeItem(k); } catch (e) { /* nothing kept */ } }

    function tabId() {
        var id = ssGet(DRAFT_KEY + '.tab');
        if (!id) {
            id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
            try { w.sessionStorage.setItem(DRAFT_KEY + '.tab', id); } catch (e) { /* no session storage: no copy */ }
        }
        return id;
    }

    function dbDo(mode, fn) {
        return new Promise(function (resolve, reject) {
            if (!w.indexedDB) { reject(new Error('No IndexedDB')); return; }
            var open = w.indexedDB.open(DRAFT_DB, 1);
            open.onupgradeneeded = function () { open.result.createObjectStore('drafts'); };
            open.onerror = function () { reject(open.error); };
            open.onblocked = function () { reject(new Error('IndexedDB blocked')); };
            open.onsuccess = function () {
                var con = open.result, out, tx;
                try { tx = con.transaction('drafts', mode); } catch (e) { con.close(); reject(e); return; }
                var req = fn(tx.objectStore('drafts'));
                if (req) { req.onsuccess = function () { out = req.result; }; }
                tx.oncomplete = function () { con.close(); resolve(out); };
                tx.onerror = tx.onabort = function () { con.close(); reject(tx.error); };
            };
        });
    }

    function toText(buf) {
        var b = new Uint8Array(buf), s = '', i;
        for (i = 0; i < b.length; i += 0x8000) { s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); }
        return w.btoa(s);
    }

    function fromText(t) {
        var s = w.atob(t), b = new Uint8Array(s.length), i;
        for (i = 0; i < s.length; i++) { b[i] = s.charCodeAt(i); }
        return b.buffer;
    }

    /* This tab's copy is deleted (session storage, and its IndexedDB copy if it has one). */
    function dropDraft() {
        var id = ssGet(DRAFT_KEY + '.tab');
        var inDb = draftInDb || /"where":"db"/.test(ssGet(DRAFT_KEY) || '');
        ssDel(DRAFT_KEY);
        ssDel(DRAFT_KEY + '.data');
        draftInDb = false;
        if (inDb && id && w.indexedDB) { dbDo('readwrite', function (st) { return st.delete(id); }).catch(function () { /* none */ }); }
    }

    /* Copies left by any other login (or older than 12 hours) are deleted; with nobody logged in, all of them. */
    function sweepDrafts(mark) {
        if (!w.indexedDB) { return; }
        if (!mark) {
            try { w.indexedDB.deleteDatabase(DRAFT_DB); } catch (e) { /* none */ }
            return;
        }
        dbDo('readwrite', function (st) {
            var cur = st.openCursor();
            cur.onsuccess = function () {
                var c = cur.result;
                if (!c) { return; }
                var v = c.value || {};
                if (v.tok !== mark || !(Date.now() - (v.time || 0) < DRAFT_MAX_AGE)) { c.delete(); }
                c.continue();
            };
        }).catch(function () { /* nothing kept */ });
    }

    function putDraft(rec, buf) {
        var id = tabId();
        rec.tok = draftMark;
        rec.time = Date.now();
        if (buf.byteLength <= DRAFT_SMALL) {
            try {
                w.sessionStorage.setItem(DRAFT_KEY + '.data', toText(buf));
                rec.where = 'tab';
                w.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(rec));
                if (draftInDb) { draftInDb = false; dbDo('readwrite', function (st) { return st.delete(id); }).catch(function () { /* none */ }); }
                return Promise.resolve();
            } catch (e) {
                ssDel(DRAFT_KEY + '.data'); // session storage is full: IndexedDB instead
            }
        }
        return dbDo('readwrite', function (st) { return st.put({ tok: rec.tok, time: rec.time, data: buf }, id); }).then(function () {
            draftInDb = true;
            rec.where = 'db';
            ssDel(DRAFT_KEY + '.data');
            try { w.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(rec)); } catch (e) { /* no copy */ }
        });
    }

    function readDraft() {
        var meta = null;
        try { meta = JSON.parse(ssGet(DRAFT_KEY) || 'null'); } catch (e) { meta = null; }
        if (!meta || !draftMark || meta.tok !== draftMark) { dropDraft(); return Promise.resolve(null); }
        if (meta.where === 'tab') {
            var t = ssGet(DRAFT_KEY + '.data');
            try { return Promise.resolve(t ? { meta: meta, data: fromText(t) } : null); } catch (e) { return Promise.resolve(null); }
        }
        var id = ssGet(DRAFT_KEY + '.tab');
        if (!id) { return Promise.resolve(null); }
        return dbDo('readonly', function (st) { return st.get(id); }).then(function (r) {
            if (r && r.tok === draftMark && r.data) { draftInDb = true; return { meta: meta, data: r.data }; }
            return null;
        }, function () { return null; });
    }

    /* Changes are copied a moment after the student stops (at most every 8 seconds while they keep going). */
    function laterDraft() {
        if (!draftReady) { return; }
        if (!draftFirst) { draftFirst = Date.now(); }
        clearTimeout(draftTimer);
        draftTimer = setTimeout(keepDraft, Date.now() - draftFirst > 8000 ? 0 : 1500);
    }

    function keepDraft() {
        draftTimer = 0;
        var v = engine();
        if (!v || !token || !draftMark || !draftReady) { draftFirst = 0; return; }
        if (opening || draftBusy) { draftAgain = true; return; }
        draftFirst = 0;
        draftBusy = true;
        var rec = { current: current, dirty: dirty };
        Promise.resolve(v.saveProjectSb3()).then(function (sb3) {
            if (sb3 instanceof ArrayBuffer) { return sb3; }
            return sb3 && sb3.arrayBuffer ? sb3.arrayBuffer() : new Response(sb3).arrayBuffer();
        }).then(function (buf) {
            return putDraft(rec, buf);
        }).catch(function () { /* storage full or blocked: a refresh starts empty, as before */ }).then(function () {
            draftBusy = false;
            if (draftAgain) { draftAgain = false; laterDraft(); }
        });
    }

    /* Scratch first opens its own starting project; the copy is opened after that, or Scratch would open over it. */
    function whenShowing(fn) {
        (function check(tries) {
            var s = reduxStore(), st = null;
            try { st = s ? s.getState().scratchGui.projectState.loadingState : null; } catch (e) { st = null; }
            if (st === 'SHOWING_WITHOUT_ID' || st === 'SHOWING_WITH_ID' || tries >= 200) { fn(); return; }
            setTimeout(function () { check(tries + 1); }, 100);
        })(0);
    }

    function restoreDraft() {
        return readDraft().then(function (got) {
            var v = engine();
            if (!got || !v) { return false; }
            opening++;
            return v.loadProject(got.data).then(function () {
                var rec = got.meta;
                setScratchTitle(rec.current ? rec.current.title : '');
                // The same as opening from My Work, but (saved)/(unsaved) is as it was before the refresh.
                current = rec.current || null;
                dirty = !!rec.dirty;
                showCurrent();
                setTimeout(function () { opening = Math.max(0, opening - 1); dirty = !!rec.dirty; showCurrent(); }, 1200);
                return true;
            }, function () { opening = Math.max(0, opening - 1); dropDraft(); return false; });
        }).catch(function () { return false; });
    }

    function hasOpenAddress() {
        var host = w;
        try { if (w.parent !== w && w.parent.location.search) { host = w.parent; } } catch (e) { host = w; }
        return /[?&]open=\d{1,10}(?:&|$)/.test(host.location.search || '');
    }

    function startDraft() {
        draftMark = tokenMark(token);
        sweepDrafts(draftMark);
        if (hasOpenAddress()) {
            // A project asked for in the address wins over the copy kept for a refresh.
            dropDraft();
            draftReady = true;
            setTimeout(openFromAddress, 400);
            return;
        }
        whenShowing(function () {
            restoreDraft().then(function () { draftReady = true; });
        });
    }

    /* ---------- start ---------- */

    w.dc360ScratchSave = { save: openSave, work: openWork, quick: quickSave };

    d.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            e.stopPropagation();
            quickSave();
        }
    }, true);

    (function wait(tries) {
        var v = engine();
        if (!v) { if (tries < 300) { setTimeout(function () { wait(tries + 1); }, 100); } return; }
        v.on('PROJECT_CHANGED', function () { changed(); laterDraft(); });
        fetch(api + 'project.boot', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.ok && j.loggedIn && j.token) { token = j.token; loadMarking(); startDraft(); }
            else {
                // Nobody logged in: no copy kept for a refresh is ever opened, and every one is deleted.
                dropDraft();
                sweepDrafts('');
            }
        }).catch(function () { /* Not inside DC360: Save to DC360 says so. */ });
    })(0);
})(window, document);
