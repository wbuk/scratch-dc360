/* Scratch on DC360: Save to DC360, My Work, Current file, the Help menu and no uploads, the same as the other DC360
   apps. Added by the Libraries app updater (recipe scratch), so it comes back after every Scratch update.

   It works through Scratch's own engine (the VM, found through React), so nothing in Scratch's code needs changing:
   - Save:  vm.saveProjectSb3() (the .sb3 file) plus a picture of the stage (vm.renderer.requestSnapshot), sent to
            com_dc360scratch. The server leaves out Scratch library costumes and sounds (DC360 keeps one copy).
   - Open:  com_dc360scratch project.load gives the whole .sb3 back; vm.loadProject() opens it.
   - File menu: "Save to DC360" and "My Work" are added; "Load from your computer" is removed (no uploads).
   - No uploads: every way of choosing a file from the computer (Upload Sprite / Costume / Backdrop / Sound, Load from
     your computer, dropping a file) is blocked. Students draw, record, or use the Scratch library.
   ?open=<id> on the DC360 page's address (My Work's Open, a teacher's Edit) opens that project.
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
    var NO_UPLOADS = 'On DC360, Scratch cannot open files from your computer. Draw your own costumes, record sounds, or choose from the Scratch library. Open your saved projects with File > My Work.';

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
        }).catch(function () { say('That project could not be opened. Use File > My Work to find it.', true); });
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

    /* ---------- the menu bar ---------- */

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
        if (!bar || d.getElementById('dc360_sc_current')) { return; }
        var group = bar.querySelector('[class*="menu-bar_file-group"]') || bar.firstElementChild;
        var cur = el('button', 'dc360-sc-current');
        cur.type = 'button';
        cur.id = 'dc360_sc_current';
        cur.addEventListener('click', quickOrSave);
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
        Array.prototype.forEach.call(d.querySelectorAll('[class*="menu-bar_menu-bar-menu"] ul, ul[class*="menu_menu_"]'), fixFileMenu);
    }).observe(d.documentElement, { childList: true, subtree: true });

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
        v.on('PROJECT_CHANGED', changed);
        fetch(api + 'project.boot', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.ok && j.loggedIn && j.token) { token = j.token; loadMarking(); setTimeout(openFromAddress, 400); }
        }).catch(function () { /* Not inside DC360: Save to DC360 says so. */ });
    })(0);
})(window, document);
