(function () {
    // --- 1. IPC Abstraction Layer ---
    let ipcCount = 0;
    const ipcCountEl = document.getElementById('ipc-count');

    function sendIpcMessage(channel, payload) {
        if (window.electronAPI && typeof window.electronAPI.send === 'function') {
            window.electronAPI.send(channel, payload);
        } else if (window.adrenaline && typeof window.adrenaline.send === 'function') {
            window.adrenaline.send(channel, payload);
        } else if (window.__adrenaline_ipc_send) {
            window.__adrenaline_ipc_send(channel, payload);
        }
    }

    function onIpcMessage(channel, callback) {
        if (window.electronAPI && typeof window.electronAPI.on === 'function') {
            window.electronAPI.on(channel, callback);
        } else if (window.adrenaline && typeof window.adrenaline.on === 'function') {
            window.adrenaline.on(channel, callback);
        }
    }

    onIpcMessage('ping-from-main', function (data) {
        ipcCount++;
        if (ipcCountEl) ipcCountEl.textContent = ipcCount;
        sendIpcMessage('pong-from-renderer', {
            receivedSeq: data ? data.seq : 0,
            timestamp: Date.now()
        });
    });

    // Notify runner that interactive paint is complete
    requestAnimationFrame(function () {
        setTimeout(function () {
            sendIpcMessage('app-ready', { time: Date.now() });
        }, 50);
    });


    // --- 2. Dynamic 500+ Record Dataset & Search Table ---
    const tableBody = document.getElementById('table-body');
    const recordCountEl = document.getElementById('record-count');
    const searchInput = document.getElementById('search-input');

    const firstNames = ['Alex', 'Sam', 'Taylor', 'Jordan', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery', 'Dakota'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Jones', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor'];
    const roles = ['Software Engineer', 'Product Manager', 'UX Designer', 'Data Scientist', 'DevOps Lead', 'QA Analyst'];
    const departments = ['Engineering', 'Product', 'Design', 'Analytics', 'Operations', 'Security'];
    const statuses = ['Active', 'Pending', 'Offline', 'Busy'];

    const records = [];
    for (let i = 1; i <= 500; i++) {
        const fn = firstNames[i % firstNames.length];
        const ln = lastNames[(i * 3) % lastNames.length];
        records.push({
            id: i,
            name: fn + ' ' + ln,
            role: roles[i % roles.length],
            department: departments[i % departments.length],
            status: statuses[i % statuses.length],
            value: (Math.sin(i) * 1000 + 1500).toFixed(2)
        });
    }

    function renderTable(filterText) {
        const term = (filterText || '').toLowerCase();
        const filtered = records.filter(function (r) {
            if (!term) return true;
            return r.name.toLowerCase().includes(term) ||
                   r.role.toLowerCase().includes(term) ||
                   r.status.toLowerCase().includes(term) ||
                   r.department.toLowerCase().includes(term);
        });

        let html = '';
        for (let i = 0; i < filtered.length; i++) {
            const r = filtered[i];
            html += '<tr>' +
                '<td>' + r.id + '</td>' +
                '<td>' + r.name + '</td>' +
                '<td>' + r.role + '</td>' +
                '<td>' + r.department + '</td>' +
                '<td>' + r.status + '</td>' +
                '<td>$' + r.value + '</td>' +
            '</tr>';
        }
        tableBody.innerHTML = html;
        if (recordCountEl) recordCountEl.textContent = filtered.length;
    }

    renderTable('');

    if (searchInput) {
        searchInput.addEventListener('input', function (e) {
            renderTable(e.target.value);
        });
    }


    // --- 3. Active 60fps Canvas Animation Simulation ---
    const canvas = document.getElementById('anim-canvas');
    const fpsCountEl = document.getElementById('fps-count');
    const ctx = canvas.getContext('2d');

    const particles = [];
    for (let i = 0; i < 60; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 3,
            vy: (Math.random() - 0.5) * 3,
            radius: Math.random() * 4 + 2,
            color: 'hsl(' + (Math.random() * 360) + ', 70%, 60%)'
        });
    }

    let lastFrameTime = performance.now();
    let frameCount = 0;
    let lastFpsUpdate = performance.now();

    function animate(now) {
        frameCount++;
        if (now - lastFpsUpdate >= 500) {
            const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
            if (fpsCountEl) fpsCountEl.textContent = fps;
            frameCount = 0;
            lastFpsUpdate = now;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
        }

        // Connect nearby particles
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 0.8;
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 80) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }

        requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
})();
