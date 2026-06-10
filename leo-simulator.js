/**
 * 3GPP TS 38.101-5 LEO Satellite Simulator
 * Real-time Physical Layer Simulation (Doppler, FSPL, TA, Phased Array)
 */

window.addEventListener('DOMContentLoaded', () => {
    // --- Physics & Constant Parameters ---
    const c = 299792458; // Speed of light (m/s)
    const fc = 2.0e9;    // Carrier frequency 2.0 GHz (S-band)
    const lambda = c / fc; // Wavelength (m)
    const R_E = 6371.0;  // Earth Radius (km)
    const H = 600.0;     // LEO Satellite Altitude (km)
    const r_orb = R_E + H; // Orbit Radius (km)
    
    // Orbital speed v = sqrt(GM / r). For Earth, GM = 3.986e5 km^3/s^2.
    // v_orb = sqrt(3.986e5 / 6971) = 7.562 km/s = 7562 m/s
    const v_orb = 7562.0; 
    const omega = v_orb / (r_orb * 1000); // Orbital angular speed (rad/s) ~ 1.085e-3
    
    // Calculate maximum time t (seconds) from zenith where elevation angle >= 10 degrees
    function getMinElevationLimitTime(minElDeg) {
        const minElRad = minElDeg * Math.PI / 180;
        const targetSin = Math.sin(minElRad);
        // Scan t from 0 to 1000s to find where elevation drops below 10 degrees
        for (let t = 0; t < 1000; t += 0.5) {
            let theta = t * omega;
            let z_sat = r_orb * Math.cos(theta);
            let x_sat = r_orb * Math.sin(theta);
            
            // GS at (0, 0, R_E)
            let dx = x_sat;
            let dz = z_sat - R_E;
            let dist = Math.sqrt(dx * dx + dz * dz);
            let sinEl = dz / dist;
            if (sinEl < targetSin) {
                return t;
            }
        }
        return 250.0; // Fallback
    }
    
    const maxOrbitTime = getMinElevationLimitTime(10.0); // Approx 248 seconds
    
    // --- Simulation State ---
    let simTime = 0.0; // Current time in orbit (seconds from zenith)
    let isPlaying = true;
    let velocityError = 0.0; // m/s
    let precompensationOn = true;
    let rainLoss = 0.0; // dB
    let channelBW_MHz = 10; // Channel Bandwidth in MHz
    let satRxGainValue = 28.0; // dBi (Satellite Rx Antenna Peak Gain)
    let pointingError = 0.0; // degrees (mechanical pointing error)
    let selectedTA = 4.0; // ms (Timing Advance)
    let animationFrameId = null;
    
    // --- DOM Elements ---
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playBtnText = document.getElementById('play-btn-text');
    const resetBtn = document.getElementById('reset-btn');
    
    const timeSlider = document.getElementById('orbit-time-slider');
    const timeVal = document.getElementById('orbit-time-val');
    
    const precompToggle = document.getElementById('doppler-precomp');
    const velErrorSlider = document.getElementById('velocity-error-slider');
    const velErrorVal = document.getElementById('velocity-error-val');
    
    const rainSlider = document.getElementById('rain-loss-slider');
    const rainVal = document.getElementById('rain-loss-val');
    const bwSelect = document.getElementById('bw-select');
    const bwVal = document.getElementById('bw-val');
    const satRxGainSlider = document.getElementById('sat-rx-gain-slider');
    const satRxGainValEl = document.getElementById('sat-rx-gain-val');
    const pointingErrorSlider = document.getElementById('pointing-error-slider');
    const pointingErrorValEl = document.getElementById('pointing-error-val');
    const hpbwInfo = document.getElementById('hpbw-info');
    
    const taSlider = document.getElementById('ta-slider');
    const taVal = document.getElementById('ta-val');
    const requiredRttInfo = document.getElementById('required-rtt-info');
    
    const arrayColsSlider = document.getElementById('array-cols-slider');
    const arrayColsVal = document.getElementById('array-cols-val');
    const arrayRowsSlider = document.getElementById('array-rows-slider');
    const arrayRowsVal = document.getElementById('array-rows-val');
    const txPowerSlider = document.getElementById('tx-power-slider');
    const txPowerVal = document.getElementById('tx-power-val');
    const totalElementsInfo = document.getElementById('total-elements-info');
    const peakEirpInfo = document.getElementById('peak-eirp-info');
    const eirpCard = document.getElementById('eirp-card');
    const eirpCardVal = document.getElementById('eirp-card-val');
    
    const spacingSlider = document.getElementById('spacing-slider');
    const spacingVal = document.getElementById('spacing-val');
    const steeringSlider = document.getElementById('steering-slider');
    const steeringVal = document.getElementById('steering-val');
    const taylorToggle = document.getElementById('taylor-toggle');

    const canvasTracker = document.getElementById('canvas-tracker');
    const ctxTracker = canvasTracker.getContext('2d');
    const badgeTracker = document.getElementById('badge-tracker');
    const autotrackToggle = document.getElementById('autotrack-toggle');
    
    // Badges
    const badgeDoppler = document.getElementById('badge-doppler');
    const badgeLink = document.getElementById('badge-link');
    const badgeTiming = document.getElementById('badge-timing');
    const badgePhased = document.getElementById('badge-phased');
    
    // Telemetry fields
    const telIdealDoppler = document.getElementById('tel-ideal-doppler');
    const telCompDoppler = document.getElementById('tel-comp-doppler');
    const telResidualDoppler = document.getElementById('tel-residual-doppler');
    const telElevation = document.getElementById('tel-elevation');
    const telSlantRange = document.getElementById('tel-slant-range');
    const telFspl = document.getElementById('tel-fspl');
    const telEirp = document.getElementById('tel-eirp');
    const telPointingLoss = document.getElementById('tel-pointing-loss');
    const telEffectiveEirp = document.getElementById('tel-effective-eirp');
    const telRxLevel = document.getElementById('tel-rx-level');
    const telMargin = document.getElementById('tel-margin');
    const telRtt = document.getElementById('tel-rtt');
    const telTa = document.getElementById('tel-ta');
    const telTimingOffset = document.getElementById('tel-timing-offset');
    
    // Configure sliders limits dynamically based on physics
    timeSlider.min = -Math.floor(maxOrbitTime);
    timeSlider.max = Math.floor(maxOrbitTime);
    timeSlider.value = 0;
    
    // --- Chart 1: Doppler Shift Tracking (ECharts) ---
    const dopplerChart = echarts.init(document.getElementById('chart-doppler'));
    
    // Precompute the Ideal Doppler S-curve for plotting background
    const dopplerCurveData = [];
    const ppmLimit = 0.1; // 0.1 PPM
    const syncLimitHz = ppmLimit * 1e-6 * fc; // 200 Hz
    
    for (let t = -maxOrbitTime; t <= maxOrbitTime; t += 5.0) {
        let theta = t * omega;
        let d = Math.sqrt(r_orb*r_orb + R_E*R_E - 2*r_orb*R_E*Math.cos(theta));
        let v_los = (v_orb * R_E * Math.sin(theta)) / d;
        let fd = -(fc / c) * v_los; // Hz
        dopplerCurveData.push([t, fd / 1000]); // in kHz
    }
    
    const dopplerOption = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: '#090e1a', borderColor: '#1e293b', textStyle: { color: '#f8fafc' } },
        grid: { top: 30, bottom: 40, left: 55, right: 15 },
        xAxis: {
            name: 'Time (s)',
            nameLocation: 'middle',
            nameGap: 25,
            type: 'value',
            min: -Math.floor(maxOrbitTime),
            max: Math.floor(maxOrbitTime),
            splitLine: { lineStyle: { color: '#1e293b' } },
            axisLabel: { color: '#94a3b8' }
        },
        yAxis: {
            name: 'Frequency Shift (kHz)',
            nameLocation: 'middle',
            nameGap: 40,
            type: 'value',
            min: -50,
            max: 50,
            splitLine: { lineStyle: { color: '#1e293b' } },
            axisLabel: { color: '#94a3b8' }
        },
        series: [
            {
                name: 'Ideal Doppler',
                type: 'line',
                data: dopplerCurveData,
                smooth: true,
                showSymbol: false,
                lineStyle: { color: '#06b6d4', width: 2, type: 'dashed' }
            },
            {
                name: 'Residual Error',
                type: 'line',
                data: [],
                smooth: true,
                showSymbol: false,
                lineStyle: { color: '#ef4444', width: 2 }
            },
            {
                name: 'Current Time',
                type: 'scatter',
                data: [[0, 0]],
                symbolSize: 10,
                itemStyle: { color: '#d946ef', shadowBlur: 8, shadowColor: '#d946ef' }
            }
        ]
    };
    dopplerChart.setOption(dopplerOption);
    
    // --- Chart 2: Link Margin Gauge (ECharts) ---
    const linkChart = echarts.init(document.getElementById('chart-gauge-link'));
    const linkOption = {
        backgroundColor: 'transparent',
        animationDurationUpdate: 0,
        series: [{
            type: 'gauge',
            center: ['50%', '55%'],
            startAngle: 200,
            endAngle: -20,
            min: -10,
            max: 40,
            splitNumber: 10,
            radius: '90%',
            animationDurationUpdate: 0,
            axisLine: {
                lineStyle: {
                    width: 8,
                    color: [
                        [0.2, '#ef4444'],  // -10 to 0 (deficit)
                        [0.4, '#f59e0b'],  //  0 to 10 (marginal)
                        [1, '#10b981']     // 10 to 40 (good)
                    ]
                }
            },
            pointer: { icon: 'path://M12.8,0.7l12,8.5c0.5,0.4,0.2,1.2-0.4,1.2H0.7c-0.6,0-0.9-0.8-0.4-1.2L12.3,0.7C12.5,0.5,12.6,0.5,12.8,0.7z', length: '70%', width: 5, offsetCenter: [0, '5%'], itemStyle: { color: '#f8fafc' } },
            axisTick: { distance: -8, length: 5, lineStyle: { color: '#090e1a', width: 2 } },
            splitLine: { distance: -8, length: 10, lineStyle: { color: '#090e1a', width: 3 } },
            axisLabel: { color: '#94a3b8', distance: 12, fontSize: 10, formatter: '{value}' },
            anchor: { show: true, showAbove: true, size: 12, itemStyle: { color: '#f8fafc' } },
            title: { show: true, offsetCenter: [0, '35%'], textStyle: { color: '#94a3b8', fontSize: 11, fontWeight: 500 } },
            detail: { valueAnimation: false, offsetCenter: [0, '-15%'], formatter: '{value} dB', textStyle: { color: '#10b981', fontSize: 18, fontWeight: 'bold', fontFamily: 'JetBrains Mono' } },
            data: [{ value: 6.0, name: 'Link Margin' }]
        }]
    };
    linkChart.setOption(linkOption);
    
    // --- Canvas: Module 3 Timing Advance Gantt ---
    const canvasTiming = document.getElementById('canvas-timing');
    const ctxTiming = canvasTiming.getContext('2d');
    
    // Setup high DPI canvas
    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvasTiming.parentNode.getBoundingClientRect();
        canvasTiming.width = rect.width * dpr;
        canvasTiming.height = rect.height * dpr;
        canvasTiming.style.width = rect.width + 'px';
        canvasTiming.style.height = rect.height + 'px';
        ctxTiming.scale(dpr, dpr);
    }
    resizeCanvas();
    
    // Setup high DPI canvas for Tracker
    function resizeCanvasTracker() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvasTracker.parentNode.getBoundingClientRect();
        canvasTracker.width = rect.width * dpr;
        canvasTracker.height = rect.height * dpr;
        canvasTracker.style.width = rect.width + 'px';
        canvasTracker.style.height = rect.height + 'px';
        ctxTracker.scale(dpr, dpr);
    }
    resizeCanvasTracker();

    // --- Master Tracker Drawing Function ---
    function drawTrackerDiagram(ctx, width, height, theta, elevationDeg, d_sat, steeringDeg, Nx, timestamp) {
        ctx.clearRect(0, 0, width, height);
        
        // 1. Space background gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#03060b');
        bgGrad.addColorStop(1, '#090e1a');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);
        
        // 2. Center/Dimensions
        const ueX = width / 2;
        const ueY = height - 40;
        const rEarth = 350;
        const earthCenterX = ueX;
        const earthCenterY = ueY + rEarth;
        const altSat = 110;
        const rOrbit = rEarth + altSat;
        
        // 3. Draw Earth
        ctx.beginPath();
        ctx.arc(earthCenterX, earthCenterY, rEarth, 0, Math.PI * 2);
        ctx.fillStyle = '#060913';
        ctx.fill();
        
        // Glowing Earth boundary arc
        ctx.beginPath();
        ctx.arc(earthCenterX, earthCenterY, rEarth, -Math.PI, 0);
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(earthCenterX, earthCenterY, rEarth, -Math.PI, 0);
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Draw some visual indicators for the Earth surface
        ctx.beginPath();
        ctx.arc(earthCenterX, earthCenterY, rEarth + 1, -Math.PI, 0);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 4. Draw Orbital Arc (Dashed)
        ctx.beginPath();
        ctx.arc(earthCenterX, earthCenterY, rOrbit, -Math.PI, 0);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // 5. Calculate Satellite position on screen
        const angleScale = 3.5;
        const drawTheta = theta * angleScale;
        const satX = earthCenterX + rOrbit * Math.sin(drawTheta);
        const satY = earthCenterY - rOrbit * Math.cos(drawTheta);
        
        // 6. Draw vertical ground track guideline
        const dx = satX - earthCenterX;
        let intersectY = ueY;
        if (Math.abs(dx) < rEarth) {
            intersectY = earthCenterY - Math.sqrt(rEarth * rEarth - dx * dx);
        }
        ctx.beginPath();
        ctx.moveTo(satX, satY);
        ctx.lineTo(satX, intersectY);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Tiny dot at the sub-satellite track point
        ctx.beginPath();
        ctx.arc(satX, intersectY, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#94a3b8';
        ctx.fill();
        
        // 7. Draw Beam Cone emanating from UE (Phased Array)
        const steeringRad = steeringDeg * Math.PI / 180;
        const visualSteeringAngle = -Math.PI / 2 + steeringRad * angleScale;
        const beamHalfWidth = Math.max(2.0, 30 / Nx) * Math.PI / 180;
        
        const beamLen = 170;
        const leftAngle = visualSteeringAngle - beamHalfWidth;
        const rightAngle = visualSteeringAngle + beamHalfWidth;
        
        const xLeft = ueX + beamLen * Math.cos(leftAngle);
        const yLeft = ueY + beamLen * Math.sin(leftAngle);
        const xRight = ueX + beamLen * Math.cos(rightAngle);
        const yRight = ueY + beamLen * Math.sin(rightAngle);
        
        const beamGrad = ctx.createRadialGradient(ueX, ueY, 5, ueX, ueY, beamLen);
        beamGrad.addColorStop(0, 'rgba(217, 70, 239, 0.4)');
        beamGrad.addColorStop(0.4, 'rgba(217, 70, 239, 0.12)');
        beamGrad.addColorStop(1, 'rgba(217, 70, 239, 0.0)');
        
        ctx.beginPath();
        ctx.moveTo(ueX, ueY);
        ctx.lineTo(xLeft, yLeft);
        ctx.arc(ueX, ueY, beamLen, leftAngle, rightAngle);
        ctx.lineTo(ueX, ueY);
        ctx.fillStyle = beamGrad;
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(ueX, ueY);
        ctx.lineTo(xLeft, yLeft);
        ctx.moveTo(ueX, ueY);
        ctx.lineTo(xRight, yRight);
        ctx.strokeStyle = 'rgba(217, 70, 239, 0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // 8. Draw Line of Sight (LoS) connecting UE to Satellite
        const isVisible = elevationDeg >= 10.0;
        ctx.beginPath();
        ctx.moveTo(ueX, ueY);
        ctx.lineTo(satX, satY);
        ctx.strokeStyle = isVisible ? 'rgba(6, 182, 212, 0.35)' : 'rgba(239, 68, 68, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // 9. Draw Ground Station (UE)
        const pulsePeriod = 1200;
        const pulseTime = timestamp % pulsePeriod;
        const pulseRadius = 5 + (pulseTime / pulsePeriod) * 14;
        const pulseOpacity = 1 - (pulseTime / pulsePeriod);
        ctx.beginPath();
        ctx.arc(ueX, ueY, pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(16, 185, 129, ${pulseOpacity * 0.75})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(ueX, ueY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = '#f8fafc';
        ctx.font = '500 9px "Inter"';
        ctx.textAlign = 'center';
        ctx.fillText('UE GS', ueX, ueY + 16);
        
        // 10. Draw Satellite
        ctx.save();
        ctx.translate(satX, satY);
        const angleToEarth = Math.atan2(earthCenterY - satY, earthCenterX - satX);
        ctx.rotate(angleToEarth - Math.PI / 2);
        
        ctx.fillStyle = 'rgba(6, 182, 212, 0.85)';
        ctx.fillRect(-22, -2.5, 14, 5);
        ctx.fillRect(8, -2.5, 14, 5);
        
        ctx.strokeStyle = '#03060b';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(-22, -2.5, 14, 5);
        ctx.strokeRect(8, -2.5, 14, 5);
        
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(-4.5, -4.5, 9, 9);
        ctx.strokeRect(-4.5, -4.5, 9, 9);
        
        ctx.beginPath();
        ctx.arc(0, 5, 4.5, Math.PI, 0);
        ctx.fillStyle = '#94a3b8';
        ctx.fill();
        ctx.restore();
        
        // 11. Draw Telemetry text labels
        const midX = (ueX + satX) / 2;
        const midY = (ueY + satY) / 2;
        const textOffsetX = satX > ueX ? 15 : -110;
        const textOffsetY = -10;
        
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '10px "JetBrains Mono"';
        ctx.textAlign = 'left';
        ctx.fillText(`Elev: ${elevationDeg.toFixed(1)}°`, midX + textOffsetX, midY + textOffsetY);
        ctx.fillText(`Range: ${d_sat.toFixed(1)} km`, midX + textOffsetX, midY + textOffsetY + 13);
        
        ctx.fillStyle = isVisible ? 'rgba(6, 182, 212, 0.8)' : 'rgba(239, 68, 68, 0.8)';
        ctx.font = 'bold 9px "Inter"';
        ctx.textAlign = 'center';
        ctx.fillText(isVisible ? 'VISIBLE' : 'BLOCKED', satX, satY - 14);
    }
    
    // Packets for traveling animation
    let travelPackets = [];
    let lastPacketTime = 0;
    
    // --- Three.js: Module 4 Phased Array 3D spherical EIRP ---
    const container3d = document.getElementById('webgl-container');
    let scene3d, camera3d, renderer3d, orbitControls;
    let sphereGeometry, sphereMesh;
    let originalPositions = [];
    
    function initThreeJS() {
        const width = container3d.clientWidth;
        const height = container3d.clientHeight;
        
        scene3d = new THREE.Scene();
        scene3d.background = new THREE.Color(0x03060b);
        
        camera3d = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        camera3d.position.set(4, 3, 4);
        
        renderer3d = new THREE.WebGLRenderer({ antialias: true });
        renderer3d.setSize(width, height);
        renderer3d.setPixelRatio(window.devicePixelRatio);
        container3d.appendChild(renderer3d.domElement);
        
        orbitControls = new THREE.OrbitControls(camera3d, renderer3d.domElement);
        orbitControls.enableDamping = true;
        orbitControls.dampingFactor = 0.05;
        orbitControls.minDistance = 2;
        orbitControls.maxDistance = 15;
        
        // Full sphere geometry representing radiation space (Z is up)
        // widthSegments: 60, heightSegments: 40
        sphereGeometry = new THREE.SphereGeometry(1.0, 60, 40);
        
        // Store original positions for displacement recalculation
        const posAttr = sphereGeometry.attributes.position;
        originalPositions = new Float32Array(posAttr.array);
        
        // Create float color attribute
        const colors = new Float32Array(posAttr.count * 3);
        sphereGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        
        // Material with vertex colors enabled
        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            wireframe: false
        });
        
        sphereMesh = new THREE.Mesh(sphereGeometry, material);
        scene3d.add(sphereMesh);
        
        // Add a grid helper in the XY ground plane
        const gridHelper = new THREE.GridHelper(6, 20, 0x1e293b, 0x0f172a);
        gridHelper.rotation.x = Math.PI / 2; // Lie on XY plane
        gridHelper.position.z = -0.05; // Slightly offset below
        scene3d.add(gridHelper);
        
        // Coordinate axes lines
        const axesHelper = new THREE.AxesHelper(3);
        axesHelper.position.z = 0.01;
        scene3d.add(axesHelper);
    }
    initThreeJS();
    
    // Jet Colormap helper (0.0 = blue, 0.5 = green/yellow, 1.0 = red)
    function jetColor(v) {
        const r = Math.max(0, Math.min(1, 1.5 - 4 * Math.abs(v - 0.75)));
        const g = Math.max(0, Math.min(1, 1.5 - 4 * Math.abs(v - 0.5)));
        const b = Math.max(0, Math.min(1, 1.5 - 4 * Math.abs(v - 0.25)));
        return [r, g, b];
    }
    
    // Taylor Window weight calculator (low sidelobes)
    function getTaylorWeights(N, SLL = -30, nbar = 4) {
        const weights = new Array(N).fill(0);
        const A = Math.acosh(Math.pow(10, -SLL / 20)) / Math.PI;
        const sigma2 = (nbar * nbar) / (A * A + (nbar - 0.5) * (nbar - 0.5));
        
        for (let i = 0; i < N; i++) {
            const z = (i - (N - 1) / 2) / (N / 2);
            let sum = 0;
            for (let m = 1; m < nbar; m++) {
                let num = 1;
                let den = 1;
                for (let p = 1; p < nbar; p++) {
                    const numTerm = 1 - (m * m) / (sigma2 * (A * A + (p - 0.5) * (p - 0.5)));
                    num *= numTerm;
                    if (p !== m) {
                        const denTerm = 1 - (m * m) / (p * p);
                        den *= denTerm;
                    }
                }
                const Fm = (Math.pow(-1, m + 1) / 2) * (num / den);
                sum += Fm * Math.cos(m * Math.PI * z);
            }
            weights[i] = 1 + 2 * sum;
        }
        
        // Normalize to peak value of 1.0
        const maxW = Math.max(...weights);
        return weights.map(w => w / maxW);
    }
    
    // --- Chart 4: 2D Off-axis Mask (ECharts) ---
    const maskChart = echarts.init(document.getElementById('chart-mask'));
    const maskOption = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: '#090e1a', borderColor: '#1e293b', textStyle: { color: '#f8fafc' } },
        grid: { top: 30, bottom: 40, left: 50, right: 15 },
        xAxis: {
            name: 'Off-axis Angle (deg)',
            nameLocation: 'middle',
            nameGap: 25,
            type: 'value',
            min: -90,
            max: 90,
            splitLine: { lineStyle: { color: '#1e293b' } },
            axisLabel: { color: '#94a3b8' }
        },
        yAxis: {
            name: 'EIRP density (dBm)',
            nameLocation: 'middle',
            nameGap: 35,
            type: 'value',
            min: -20,
            max: 60,
            splitLine: { lineStyle: { color: '#1e293b' } },
            axisLabel: { color: '#94a3b8' }
        },
        series: [
            {
                name: 'ITU Regulatory Mask',
                type: 'line',
                step: 'middle',
                data: [],
                lineStyle: { color: '#ef4444', width: 2, type: 'dashed' },
                showSymbol: false
            },
            {
                name: 'Antenna EIRP Cut',
                type: 'line',
                data: [],
                lineStyle: { color: '#10b981', width: 2 },
                showSymbol: false
            }
        ]
    };
    maskChart.setOption(maskOption);
    
    // Calculate off-axis mask limits
    function getMaskLimit(angleDeg, peakEirp) {
        const absAngle = Math.abs(angleDeg);
        const limitFlat = Math.max(45, peakEirp + 2);
        const limitFar = 15; // dBm absolute
        
        if (absAngle <= 5) {
            return limitFlat;
        } else if (absAngle <= 15) {
            const t = (absAngle - 5) / 10;
            return limitFlat + t * (limitFar - limitFlat);
        } else {
            return limitFar;
        }
    }
    
    // --- Update 3D Spherical Heatmap & 2D Mask ---
    function updatePhasedArrayVisuals() {
        const Nx = parseInt(arrayColsSlider.value);
        const Ny = parseInt(arrayRowsSlider.value);
        const conductedTxPower = parseFloat(txPowerSlider.value);
        const spacing = parseFloat(spacingSlider.value);
        const steeringDeg = parseFloat(steeringSlider.value);
        const steeringRad = steeringDeg * Math.PI / 180;
        const taylorOn = taylorToggle.checked;
        
        const N = Nx * Ny;
        const peakEirp = conductedTxPower + 20 * Math.log10(N);
        
        // Update sidebar and card UI values
        totalElementsInfo.textContent = N;
        peakEirpInfo.textContent = peakEirp.toFixed(2) + ' dBm';
        eirpCardVal.textContent = peakEirp.toFixed(2) + ' dBm';
        
        // Update Estimated HPBW
        const N_max = Math.max(Nx, Ny);
        const hpbwDeg = 102.0 / N_max;
        hpbwInfo.textContent = hpbwDeg.toFixed(1) + '°';
        
        // Taylor window coefficients or uniform weights
        let wx = taylorOn ? getTaylorWeights(Nx, -30, 4) : new Array(Nx).fill(1);
        let wy = taylorOn ? getTaylorWeights(Ny, -30, 4) : new Array(Ny).fill(1);
        
        // Normalize weights by sum to keep peak power matched to EIRP calculation
        const sumWx = wx.reduce((a, b) => a + b, 0);
        const sumWy = wy.reduce((a, b) => a + b, 0);
        const wx_n = wx.map(w => w / sumWx);
        const wy_n = wy.map(w => w / sumWy);
        
        // Update 3D Mesh positions & colors
        if (sphereGeometry) {
            const posAttr = sphereGeometry.attributes.position;
            const colorAttr = sphereGeometry.attributes.color;
            const count = posAttr.count;
            const k_d = 2 * Math.PI * spacing;
            
            for (let i = 0; i < count; i++) {
                const ux = originalPositions[i * 3];
                const uy = originalPositions[i * 3 + 1];
                const uz = originalPositions[i * 3 + 2];
                
                // Convert back to angles
                let r = Math.sqrt(ux*ux + uy*uy + uz*uz);
                if (r < 0.0001) r = 1.0;
                let theta = Math.acos(uz / r); // 0 (boresight Z) to PI (full sphere)
                let phi = Math.atan2(uy, ux);  // -PI to PI
                
                // Separable Array Factor calculation
                let argX = Math.sin(theta) * Math.cos(phi) - Math.sin(steeringRad);
                let argY = Math.sin(theta) * Math.sin(phi);
                
                // Phasor recurrence for X axis
                let kd_argX = k_d * argX;
                let cosDX = Math.cos(kd_argX);
                let sinDX = Math.sin(kd_argX);
                let sumX_re = 0, sumX_im = 0;
                let currX_re = 1.0, currX_im = 0.0;
                for (let m = 0; m < Nx; m++) {
                    let w = wx_n[m];
                    sumX_re += w * currX_re;
                    sumX_im += w * currX_im;
                    let next_re = currX_re * cosDX - currX_im * sinDX;
                    let next_im = currX_re * sinDX + currX_im * cosDX;
                    currX_re = next_re;
                    currX_im = next_im;
                }
                let magX = Math.sqrt(sumX_re * sumX_re + sumX_im * sumX_im);
                
                // Phasor recurrence for Y axis
                let kd_argY = k_d * argY;
                let cosDY = Math.cos(kd_argY);
                let sinDY = Math.sin(kd_argY);
                let sumY_re = 0, sumY_im = 0;
                let currY_re = 1.0, currY_im = 0.0;
                for (let n = 0; n < Ny; n++) {
                    let w = wy_n[n];
                    sumY_re += w * currY_re;
                    sumY_im += w * currY_im;
                    let next_re = currY_re * cosDY - currY_im * sinDY;
                    let next_im = currY_re * sinDY + currY_im * cosDY;
                    currY_re = next_re;
                    currY_im = next_im;
                }
                let magY = Math.sqrt(sumY_re * sumY_re + sumY_im * sumY_im);
                
                let afMag = magX * magY;
                
                // Apply Patch Antenna Element Factor (cos(theta) for forward hemisphere, 0.0001 for back)
                let cosAlpha = uz / r;
                let EF = cosAlpha >= 0 ? cosAlpha : 0.0001;
                let gTotal = afMag * EF;
                
                let db = gTotal > 0.0001 ? 20 * Math.log10(gTotal) : -40;
                if (db < -40) db = -40; // clamp for rendering
                
                // Displace vertices: peak 0dB = scale 2.2, -40dB = scale 0.2
                let scale = 0.2 + 2.0 * (db + 40) / 40;
                posAttr.setXYZ(i, ux * scale, uy * scale, uz * scale);
                
                // Jet colormap
                let colorVal = (db + 40) / 40;
                let c_jet = jetColor(colorVal);
                colorAttr.setXYZ(i, c_jet[0], c_jet[1], c_jet[2]);
            }
            
            posAttr.needsUpdate = true;
            colorAttr.needsUpdate = true;
            sphereGeometry.computeVertexNormals();
        }
        
        // --- Update 2D Mask Cut (at phi = 0) ---
        const eirpCutData = [];
        const maskLimitData = [];
        let maskExceeded = false;
        
        for (let angleOff = -90; angleOff <= 90; angleOff += 1) {
            let theta = angleOff * Math.PI / 180 + steeringRad; // absolute theta
            let k_d = 2 * Math.PI * spacing;
            
            // Array factor along steering plane X
            let argX = Math.sin(theta) - Math.sin(steeringRad);
            
            // Phasor recurrence for X axis
            let kd_argX = k_d * argX;
            let cosDX = Math.cos(kd_argX);
            let sinDX = Math.sin(kd_argX);
            let sumX_re = 0, sumX_im = 0;
            let currX_re = 1.0, currX_im = 0.0;
            for (let m = 0; m < Nx; m++) {
                let w = wx_n[m];
                sumX_re += w * currX_re;
                sumX_im += w * currX_im;
                let next_re = currX_re * cosDX - currX_im * sinDX;
                let next_im = currX_re * sinDX + currX_im * cosDX;
                currX_re = next_re;
                currX_im = next_im;
            }
            let afMag = Math.sqrt(sumX_re*sumX_re + sumX_im*sumX_im);
            
            // Apply Patch Antenna Element Factor (cos(theta) for forward hemisphere, 0.0001 for back)
            let cosAlpha = Math.cos(theta);
            let EF = cosAlpha >= 0 ? cosAlpha : 0.0001;
            let gTotal = afMag * EF;
            
            let db = gTotal > 0.0001 ? 20 * Math.log10(gTotal) : -40;
            if (db < -40) db = -40; // clamp to -40 dB
            
            let eirp = peakEirp + db;
            let maskLimit = getMaskLimit(angleOff, peakEirp);
            
            eirpCutData.push([angleOff, parseFloat(eirp.toFixed(2))]);
            maskLimitData.push([angleOff, parseFloat(maskLimit.toFixed(2))]);
            
            if (eirp > maskLimit) {
                maskExceeded = true;
            }
        }
        
        // Update Chart
        maskChart.setOption({
            series: [
                { name: 'ITU Regulatory Mask', data: maskLimitData },
                {
                    name: 'Antenna EIRP Cut',
                    data: eirpCutData,
                    lineStyle: { color: maskExceeded ? '#ef4444' : '#10b981' }
                }
            ],
            yAxis: {
                min: Math.min(-10, Math.floor(peakEirp - 45)),
                max: Math.ceil(peakEirp + 5)
            }
        });
        
        // Update Peak EIRP card fail state
        if (maskExceeded) {
            eirpCard.classList.add('fail');
        } else {
            eirpCard.classList.remove('fail');
        }
        
        // Update Phased Array status badge
        if (maskExceeded) {
            badgePhased.className = "status-badge fail";
            badgePhased.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> FAIL: Off-axis limit exceeded';
        } else {
            badgePhased.className = "status-badge pass";
            badgePhased.innerHTML = '<i class="fa-solid fa-circle-check"></i> PASS: Off-axis Emission OK';
        }
    }
    
    // --- Debounced Phased Array updates to prevent slider lag ---
    const debouncedUpdatePhasedArray = debounce(updatePhasedArrayVisuals, 200);
    
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
    
    // --- Render Loop (Physics & Animations) ---
    let lastTime = 0;
    
    function runSimulation(timestamp) {
        if (!lastTime) lastTime = timestamp;
        let delta = (timestamp - lastTime) / 1000;
        lastTime = timestamp;
        
        // If playing, advance simulation time
        if (isPlaying) {
            simTime += delta * 5.0; // speed up pass a bit: 5 seconds of orbit time per wall clock second
            if (simTime > maxOrbitTime) {
                simTime = -maxOrbitTime; // loop back to approach
            }
            timeSlider.value = simTime.toFixed(1);
        } else {
            simTime = parseFloat(timeSlider.value);
        }
        
        // Update Time indicator
        timeVal.textContent = simTime.toFixed(1) + 's';
        
        // --- Calculate Physics Variables ---
        // 1. Orbital position
        const theta = simTime * omega;
        const d_sat = Math.sqrt(r_orb*r_orb + R_E*R_E - 2*r_orb*R_E*Math.cos(theta)); // slant range in km
        const elevationRad = Math.asin((r_orb * Math.cos(theta) - R_E) / d_sat);
        const elevationDeg = elevationRad * 180 / Math.PI;
        
        // --- Auto-Track Logic & Master Tracker updates ---
        let currentSteeringDeg = parseFloat(steeringSlider.value);
        const Nx = parseInt(arrayColsSlider.value);
        const isVisible = elevationDeg >= 10.0;
        
        if (autotrackToggle.checked) {
            const reqSteer = (simTime >= 0 ? 1 : -1) * (90 - elevationDeg);
            currentSteeringDeg = reqSteer;
            steeringSlider.value = reqSteer.toFixed(1);
            steeringVal.textContent = reqSteer.toFixed(1) + '°';
            steeringSlider.disabled = true;
            updatePhasedArrayVisuals();
        } else {
            steeringSlider.disabled = false;
        }
        
        if (isVisible) {
            badgeTracker.className = "status-badge pass";
            badgeTracker.innerHTML = '<i class="fa-solid fa-circle-check"></i> Satellite Visible';
        } else {
            badgeTracker.className = "status-badge fail";
            badgeTracker.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Horizon Blocked';
        }
        
        drawTrackerDiagram(ctxTracker, canvasTracker.width / window.devicePixelRatio, canvasTracker.height / window.devicePixelRatio, theta, elevationDeg, d_sat, currentSteeringDeg, Nx, timestamp);
        
        // 2. Doppler Shift & Pre-compensation (Module 1)
        const v_los = (v_orb * R_E * Math.sin(theta)) / d_sat; // line of sight velocity
        const fd = -(fc / c) * v_los; // Ideal Doppler in Hz
        
        let fd_est = 0.0;
        let residualError = fd;
        
        if (precompensationOn) {
            const v_los_est = ((v_orb + velocityError) * R_E * Math.sin(theta)) / d_sat;
            fd_est = -(fc / c) * v_los_est;
            residualError = fd - fd_est; // Hz
        }
        
        // 3. Link Budget & FSPL (Module 2)
        // ITU standard FSPL: FSPL(dB) = 20*log10(d_km) + 20*log10(f_MHz) + 32.44
        const f_MHz = 2000; // S-band carrier frequency in MHz
        const fspl = 20 * Math.log10(d_sat) + 20 * Math.log10(f_MHz) + 32.44;
        
        // Satellite Receiver Constants
        const satRxGain = satRxGainValue;  // dBi (from slider)
        const satNoiseFigure = 2.0;   // dB
        const requiredSNR = 0.0;      // dB (Minimum SNR to maintain link)
        const atmosphericLoss = 2.0;  // dB (gaseous absorption + scintillation)
        
        // a) Peak EIRP from Module 4 Phased Array settings
        const Nx_link = parseInt(arrayColsSlider.value);
        const Ny_link = parseInt(arrayRowsSlider.value);
        const conductedTxPower_link = parseFloat(txPowerSlider.value);
        const N_link = Nx_link * Ny_link;
        const eirp = conductedTxPower_link + 20 * Math.log10(N_link);
        
        // Step A: Calculate Beamwidth (HPBW)
        const N_max_link = Math.max(Nx_link, Ny_link);
        const hpbwDeg_link = 102.0 / N_max_link;
        
        // Step B: Calculate Pointing Loss (Gaussian Main Beam Approximation)
        let pointingLoss = 12.0 * Math.pow(pointingError / hpbwDeg_link, 2);
        pointingLoss = Math.min(pointingLoss, 30.0); // clamp max 30 dB
        
        // Step C: Effective EIRP
        const effectiveEirp = eirp - pointingLoss;
        
        // b) Rx Level (Received Power at Satellite)
        const rxLevel = effectiveEirp - fspl - atmosphericLoss - rainLoss + satRxGain;
        
        // c) Receiver Noise Floor (based on BW)
        const bwHz = channelBW_MHz * 1e6;
        const noiseFloor = -174 + 10 * Math.log10(bwHz) + satNoiseFigure;
        
        // d) Receiver Sensitivity
        const sensitivity = noiseFloor + requiredSNR;
        
        // e) Link Margin
        const margin = rxLevel - sensitivity;
        
        // 4. Large RTT & Timing Advance (Module 3)
        const rtt = 2 * (d_sat * 1000) / c * 1000; // in ms
        const timingOffset = Math.abs(selectedTA - rtt); // ms
        
        // --- Update UI Telemetry Fields ---
        telIdealDoppler.textContent = (fd / 1000).toFixed(2) + ' kHz';
        telCompDoppler.textContent = (fd_est / 1000).toFixed(2) + ' kHz';
        
        if (precompensationOn) {
            telResidualDoppler.textContent = Math.abs(residualError).toFixed(1) + ' Hz';
            if (velocityError === 0) {
                telResidualDoppler.className = "tel-val text-green";
            } else {
                telResidualDoppler.className = "tel-val text-yellow";
            }
        } else {
            telResidualDoppler.textContent = '---';
            telResidualDoppler.className = "tel-val text-muted";
        }
        
        telElevation.textContent = elevationDeg.toFixed(1) + '°';
        telSlantRange.textContent = d_sat.toFixed(1) + ' km';
        telFspl.textContent = fspl.toFixed(1) + ' dB';
        
        telEirp.textContent = eirp.toFixed(1) + ' dBm';
        
        // Pointing Loss display
        telPointingLoss.textContent = '-' + pointingLoss.toFixed(1) + ' dB';
        if (pointingLoss > 3.0) {
            telPointingLoss.className = "tel-val text-red";
        } else if (pointingLoss > 0.0) {
            telPointingLoss.className = "tel-val text-yellow";
        } else {
            telPointingLoss.className = "tel-val text-muted";
        }
        
        telEffectiveEirp.textContent = effectiveEirp.toFixed(1) + ' dBm';
        telEffectiveEirp.className = pointingLoss > 0 ? "tel-val text-yellow" : "tel-val text-cyan";
        
        telRxLevel.textContent = rxLevel.toFixed(1) + ' dBm';
        telRxLevel.className = rxLevel >= sensitivity ? "tel-val text-cyan" : "tel-val text-red";
        
        telMargin.textContent = margin.toFixed(1) + ' dB';
        telMargin.className = margin >= 0 ? "tel-val text-green" : "tel-val text-red";
        
        telRtt.textContent = rtt.toFixed(2) + ' ms';
        requiredRttInfo.textContent = rtt.toFixed(2) + ' ms';
        telTa.textContent = selectedTA.toFixed(2) + ' ms';
        telTimingOffset.textContent = timingOffset.toFixed(2) + ' ms';
        telTimingOffset.className = timingOffset <= 0.05 ? "tel-val text-green" : "tel-val text-red";
        
        // --- Update Badges and Charts ---
        // Doppler Badge
        const hasLock = Math.abs(residualError) <= syncLimitHz;
        if (hasLock) {
            badgeDoppler.className = "status-badge pass";
            badgeDoppler.innerHTML = '<i class="fa-solid fa-circle-check"></i> PASS: Frequency Synced';
        } else {
            badgeDoppler.className = "status-badge fail";
            badgeDoppler.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> FAIL: Frequency Sync Lost';
        }
        
        // Update Doppler Chart Time Marker & Residual Line
        const residualCurveData = [];
        if (precompensationOn) {
            for (let t = -maxOrbitTime; t <= maxOrbitTime; t += 5.0) {
                let th = t * omega;
                let dst = Math.sqrt(r_orb*r_orb + R_E*R_E - 2*r_orb*R_E*Math.cos(th));
                let v_l = (v_orb * R_E * Math.sin(th)) / dst;
                let v_l_est = ((v_orb + velocityError) * R_E * Math.sin(th)) / dst;
                let r_err = (-(fc / c) * v_l) - (-(fc / c) * v_l_est);
                residualCurveData.push([t, r_err / 1000]); // in kHz
            }
        } else {
            for (let t = -maxOrbitTime; t <= maxOrbitTime; t += 5.0) {
                let th = t * omega;
                let dst = Math.sqrt(r_orb*r_orb + R_E*R_E - 2*r_orb*R_E*Math.cos(th));
                let v_l = (v_orb * R_E * Math.sin(th)) / dst;
                let fd_val = -(fc / c) * v_l;
                residualCurveData.push([t, fd_val / 1000]);
            }
        }
        
        dopplerChart.setOption({
            series: [
                {}, // Keep series 0 (Ideal Doppler) intact
                { data: residualCurveData }, // Update residual curve
                { data: [[simTime, (precompensationOn ? residualError : fd) / 1000]] } // Update cursor
            ]
        });
        
        // Link Budget Gauge and Badge
        if (margin >= 0) {
            badgeLink.className = "status-badge pass";
            badgeLink.innerHTML = '<i class="fa-solid fa-circle-check"></i> PASS: Link Margin OK';
        } else {
            badgeLink.className = "status-badge fail";
            badgeLink.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> FAIL: Link Budget Deficit';
        }
        
        // Clamp gauge needle value to axis bounds [-10, 40] to prevent overflow
        const gaugeMargin = Math.max(-10, Math.min(40, parseFloat(margin.toFixed(1))));
        linkChart.setOption({
            series: [{
                data: [{ value: gaugeMargin, name: 'Link Margin' }],
                detail: {
                    formatter: margin.toFixed(1) + ' dB',
                    textStyle: { color: margin >= 0 ? '#10b981' : '#ef4444' }
                }
            }]
        });
        
        // Timing Diagram (Module 3) & Badge
        const hasTimingSync = timingOffset <= 0.05; // 0.05 ms tolerance
        if (hasTimingSync) {
            badgeTiming.className = "status-badge pass";
            badgeTiming.innerHTML = '<i class="fa-solid fa-circle-check"></i> PASS: Timing Synced';
        } else {
            badgeTiming.className = "status-badge fail";
            badgeTiming.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> FAIL: ISI / Slot Collision';
        }
        
        // Draw Timing diagram
        drawTimingDiagram(ctxTiming, canvasTiming.width / window.devicePixelRatio, canvasTiming.height / window.devicePixelRatio, rtt, selectedTA, timestamp);
        
        // Update ThreeJS Rendering
        orbitControls.update();
        renderer3d.render(scene3d, camera3d);
        
        animationFrameId = requestAnimationFrame(runSimulation);
    }
    
    // --- Timing Gantt Diagram Drawing ---
    function drawTimingDiagram(ctx, width, height, rtt, ta, timestamp) {
        ctx.clearRect(0, 0, width, height);
        
        // Horizontal slot width (1 ms = 80 pixels)
        const msPx = 80;
        const slotDuration = 1.0; // ms
        const slotWidth = slotDuration * msPx;
        
        // Center of the timeline representing reference slot zero
        const centerX = width / 2;
        
        // Draw reference grid lines (Satellite Rx Slots reference)
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        
        const numGridLines = Math.ceil(width / slotWidth);
        const gridOffset = centerX % slotWidth;
        
        for (let i = -numGridLines/2; i <= numGridLines/2; i++) {
            let x = centerX + i * slotWidth;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            
            // Draw slot index
            ctx.fillStyle = '#64748b';
            ctx.font = '8px "JetBrains Mono"';
            ctx.textAlign = 'center';
            ctx.fillText('SLOT ' + (i >= 0 ? '+' : '') + i, x + slotWidth/2, 12);
        }
        
        // Label Nodes
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '10px "Inter"';
        ctx.textAlign = 'left';
        ctx.fillText('SATELLITE (RX)', 15, 32);
        ctx.fillText('USER EQUIPMENT (TX)', 15, height - 20);
        
        // 1. Draw Satellite RX Slot Windows (Target Reference)
        // Draw a green highlight block for reference RX slot at index 0
        const rxOffset = 0; // Relative arrival time target
        const rxLeft = centerX + rxOffset * msPx;
        
        ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.fillRect(rxLeft, 20, slotWidth, 22);
        ctx.strokeRect(rxLeft, 20, slotWidth, 22);
        
        ctx.fillStyle = '#10b981';
        ctx.font = '8px "Inter"';
        ctx.textAlign = 'center';
        ctx.fillText('TARGET RX WINDOW', rxLeft + slotWidth/2, 34);
        
        // 2. Draw UE Tx Timeline Slots
        // The UE transmits packets advanced by TA relative to DL timing.
        // Downlink arrives at UE delayed by RTT/2.
        // So UE transmit time is at (RTT/2 - TA) relative to Satellite frame reference.
        // Signal arrives at Satellite at (RTT/2 - TA) + RTT/2 = RTT - TA.
        
        // Draw UE Tx slots on the bottom line
        // The offset at which UE transmits relative to satellite reference is (RTT/2 - TA)
        const txTimeOffset = (rtt / 2) - ta;
        const txLeft = centerX + txTimeOffset * msPx;
        
        ctx.fillStyle = 'rgba(217, 70, 239, 0.1)';
        ctx.strokeStyle = 'rgba(217, 70, 239, 0.3)';
        ctx.lineWidth = 1;
        
        // Draw 3 slots for UE Tx
        for (let i = -1; i <= 1; i++) {
            let x = txLeft + i * slotWidth;
            if (x + slotWidth > 0 && x < width) {
                ctx.fillRect(x, height - 38, slotWidth, 20);
                ctx.strokeRect(x, height - 38, slotWidth, 20);
                ctx.fillStyle = '#d946ef';
                ctx.font = '7px "JetBrains Mono"';
                ctx.fillText('UE TX ' + (i >= 0 ? '+' : '') + i, x + slotWidth/2, height - 26);
                ctx.fillStyle = 'rgba(217, 70, 239, 0.1)';
            }
        }
        
        // 3. Packet Transmission Animation (Traveling blocks)
        // Spawn packets periodically
        const spawnInterval = 1000; // ms
        if (timestamp - lastPacketTime > spawnInterval) {
            travelPackets.push({
                startTime: timestamp,
                slotIndex: 0 // sending in slot 0
            });
            lastPacketTime = timestamp;
        }
        
        // One-way propagation travel duration is RTT / 2
        const oneWayDuration = (rtt / 2); // ms
        
        ctx.lineWidth = 1.5;
        
        // Filter out packets that finished traveling
        travelPackets = travelPackets.filter(packet => {
            const elapsed = timestamp - packet.startTime; // wall clock ms elapsed
            const elapsedSimMs = elapsed / 10.0; // map wall clock to simulator ms (100ms wall = 10ms sim)
            
            if (elapsedSimMs > oneWayDuration) {
                // Landed at Satellite!
                // Calculate landing alignment offset: RTT - TA
                const finalOffset = rtt - ta;
                const hitTarget = Math.abs(finalOffset) <= 0.05;
                
                // Draw a ripple splash at the satellite
                ctx.beginPath();
                ctx.arc(centerX + finalOffset * msPx + slotWidth/2, 31, 20, 0, Math.PI*2);
                ctx.strokeStyle = hitTarget ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)';
                ctx.stroke();
                
                return false; // remove packet
            }
            
            // Draw traveling packet
            // Interpolate Y from UE (height - 38) to Satellite (42)
            const progress = elapsedSimMs / oneWayDuration; // 0.0 to 1.0
            const y = (height - 38) - progress * (height - 80);
            
            // Interpolate X: starts at UE TX time, shifts to arrival time (RTT - TA)
            const currentXOffset = (rtt / 2 - ta) + progress * (rtt / 2); // (RTT/2 - TA) + progress*(RTT/2)
            const x = centerX + currentXOffset * msPx;
            
            const isOverlap = Math.abs(rtt - ta) > 0.05;
            
            ctx.fillStyle = isOverlap ? 'rgba(239, 68, 68, 0.7)' : 'rgba(16, 185, 129, 0.8)';
            ctx.strokeStyle = isOverlap ? '#ef4444' : '#10b981';
            
            // Draw glowing packet rectangle
            ctx.fillRect(x, y, slotWidth, 18);
            ctx.strokeRect(x, y, slotWidth, 18);
            
            ctx.fillStyle = '#ffffff';
            ctx.font = '8px "Inter"';
            ctx.fillText('SUBFRAME 0', x + slotWidth/2, y + 12);
            
            return true;
        });
        
        // 4. Draw slot alignment status lines on top (Satellite Rx landing)
        const finalArrivalOffset = rtt - ta;
        const arrivalLeft = centerX + finalArrivalOffset * msPx;
        const isOverlap = Math.abs(finalArrivalOffset) > 0.05;
        
        ctx.fillStyle = isOverlap ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.35)';
        ctx.strokeStyle = isOverlap ? '#ef4444' : '#10b981';
        ctx.lineWidth = 1.5;
        
        ctx.fillRect(arrivalLeft, 44, slotWidth, 18);
        ctx.strokeRect(arrivalLeft, 44, slotWidth, 18);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '8px "JetBrains Mono"';
        ctx.fillText('ARRIVING PKT', arrivalLeft + slotWidth/2, 56);
        
        // Draw connection line showing offset
        ctx.strokeStyle = isOverlap ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        
        ctx.beginPath();
        ctx.moveTo(centerX + slotWidth/2, 31);
        ctx.lineTo(arrivalLeft + slotWidth/2, 44);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw overlap arrows if misaligned
        if (isOverlap) {
            ctx.fillStyle = '#ef4444';
            ctx.font = '9px "Inter"';
            ctx.fillText(finalArrivalOffset > 0 ? 'LATE ➔' : '⮨ EARLY', centerX + slotWidth/2 + (finalArrivalOffset * msPx)/2, 80);
        }
    }
    
    // --- Event Listeners & Interactive State Bindings ---
    
    // Play / Pause Simulation
    playPauseBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        if (isPlaying) {
            playPauseBtn.className = "btn primary btn-iconic";
            playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> <span id="play-btn-text">Pause</span>';
            // Resume loop if stopped
            lastTime = 0;
            if (!animationFrameId) {
                animationFrameId = requestAnimationFrame(runSimulation);
            }
        } else {
            playPauseBtn.className = "btn secondary btn-iconic";
            playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i> <span id="play-btn-text">Play</span>';
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        }
    });
    
    // Reset Simulation
    resetBtn.addEventListener('click', () => {
        simTime = 0.0;
        timeSlider.value = 0;
        timeVal.textContent = '0.0s';
        
        // Reset Doppler parameters
        precompToggle.checked = true;
        precompensationOn = true;
        velocityError = 0.0;
        velErrorSlider.value = 0;
        velErrorVal.textContent = '0.0 m/s';
        
        // Reset Link parameters
        rainSlider.value = 0;
        rainLoss = 0.0;
        rainVal.textContent = '0.0 dB';
        bwSelect.value = '10';
        channelBW_MHz = 10;
        bwVal.textContent = '10 MHz';
        satRxGainSlider.value = 28.0;
        satRxGainValue = 28.0;
        satRxGainValEl.textContent = '28.0 dBi';
        pointingErrorSlider.value = 0;
        pointingError = 0.0;
        pointingErrorValEl.textContent = '0.0°';
        
        // Reset Phased array parameters
        arrayColsSlider.value = 16;
        arrayColsVal.textContent = '16';
        arrayRowsSlider.value = 16;
        arrayRowsVal.textContent = '16';
        txPowerSlider.value = 10.0;
        txPowerVal.textContent = '10.0 dBm';
        spacingSlider.value = 0.5;
        spacingVal.textContent = '0.50';
        steeringSlider.value = 0;
        steeringVal.textContent = '0.0°';
        taylorToggle.checked = false;
        autotrackToggle.checked = true;
        steeringSlider.disabled = true;
        
        // Reset TA
        selectedTA = 4.0;
        taSlider.value = 4.0;
        taVal.textContent = '4.00 ms';
        
        travelPackets = [];
        
        // Re-run updates
        updatePhasedArrayVisuals();
        
        if (!isPlaying) {
            // Render a single frame if paused
            runSimulation(performance.now());
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    });
    
    // Time Slider
    timeSlider.addEventListener('input', (e) => {
        simTime = parseFloat(e.target.value);
        timeVal.textContent = simTime.toFixed(1) + 's';
        
        // Sync TA slider target dynamically if requested or let the user do it
        // To make it fun, we don't automatically match it, but we calculate target RTT
        const theta = simTime * omega;
        const d_sat = Math.sqrt(r_orb*r_orb + R_E*R_E - 2*r_orb*R_E*Math.cos(theta));
        const rtt = 2 * (d_sat * 1000) / c * 1000; // ms
        requiredRttInfo.textContent = rtt.toFixed(2) + ' ms';
        
        if (!isPlaying) {
            runSimulation(performance.now());
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    });
    
    // Doppler Precomp Toggle
    precompToggle.addEventListener('change', (e) => {
        precompensationOn = e.target.checked;
        if (!isPlaying) {
            runSimulation(performance.now());
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    });
    
    // Velocity Error Slider
    velErrorSlider.addEventListener('input', (e) => {
        velocityError = parseFloat(e.target.value);
        velErrorVal.textContent = velocityError.toFixed(1) + ' m/s';
        if (!isPlaying) {
            runSimulation(performance.now());
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    });
    
    // Rain Loss Slider
    rainSlider.addEventListener('input', (e) => {
        rainLoss = parseFloat(e.target.value);
        rainVal.textContent = rainLoss.toFixed(1) + ' dB';
        if (!isPlaying) {
            runSimulation(performance.now());
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    });
    
    // Bandwidth Select
    bwSelect.addEventListener('change', (e) => {
        channelBW_MHz = parseInt(e.target.value);
        bwVal.textContent = channelBW_MHz + ' MHz';
        if (!isPlaying) {
            runSimulation(performance.now());
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    });
    
    // Sat Rx Antenna Gain Slider
    satRxGainSlider.addEventListener('input', (e) => {
        satRxGainValue = parseFloat(e.target.value);
        satRxGainValEl.textContent = satRxGainValue.toFixed(1) + ' dBi';
        if (!isPlaying) {
            runSimulation(performance.now());
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    });
    
    // Pointing Error Slider
    pointingErrorSlider.addEventListener('input', (e) => {
        pointingError = parseFloat(e.target.value);
        pointingErrorValEl.textContent = pointingError.toFixed(1) + '°';
        if (!isPlaying) {
            runSimulation(performance.now());
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    });
    
    // TA Slider
    taSlider.addEventListener('input', (e) => {
        selectedTA = parseFloat(e.target.value);
        taVal.textContent = selectedTA.toFixed(2) + ' ms';
        if (!isPlaying) {
            runSimulation(performance.now());
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    });
    
    // Columns Slider
    arrayColsSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        arrayColsVal.textContent = val;
        debouncedUpdatePhasedArray();
    });
    
    // Rows Slider
    arrayRowsSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        arrayRowsVal.textContent = val;
        debouncedUpdatePhasedArray();
    });
    
    // Conducted Tx Power Slider
    txPowerSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        txPowerVal.textContent = val.toFixed(1) + ' dBm';
        debouncedUpdatePhasedArray();
    });
    
    // Element Spacing Slider
    spacingSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        spacingVal.textContent = val.toFixed(2);
        debouncedUpdatePhasedArray();
    });
    
    // Steering Angle Slider
    steeringSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        steeringVal.textContent = val.toFixed(1) + '°';
        debouncedUpdatePhasedArray();
    });
    
    // Taylor Window Toggle
    taylorToggle.addEventListener('change', () => {
        updatePhasedArrayVisuals();
    });
    
    // Auto-track toggle
    autotrackToggle.addEventListener('change', (e) => {
        if (!e.target.checked) {
            steeringSlider.disabled = false;
        } else {
            steeringSlider.disabled = true;
        }
        if (!isPlaying) {
            runSimulation(performance.now());
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    });
    
    // Resize handling
    window.addEventListener('resize', () => {
        dopplerChart.resize();
        linkChart.resize();
        maskChart.resize();
        resizeCanvas();
        resizeCanvasTracker();
        
        // Update Three.js viewport
        const width = container3d.clientWidth;
        const height = container3d.clientHeight;
        camera3d.aspect = width / height;
        camera3d.updateProjectionMatrix();
        renderer3d.setSize(width, height);
    });
    
    // --- Start Simulation ---
    updatePhasedArrayVisuals();
    animationFrameId = requestAnimationFrame(runSimulation);
});
