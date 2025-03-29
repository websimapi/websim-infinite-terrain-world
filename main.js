import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { config } from './config.js';
import { PlayerController } from './PlayerController.js';
import { WorldManager } from './WorldManager.js';

// --- Scene Setup Function ---
function setupSceneAndLighting() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue background
    scene.fog = new THREE.Fog(0x87ceeb, config.world.chunkSize * (config.world.renderDistance - 1), config.world.chunkSize * (config.world.renderDistance + 1));

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, config.world.chunkSize * (config.world.renderDistance + 2));
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows
    document.getElementById('scene-container').appendChild(renderer.domElement);

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Slightly brighter ambient
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); // Slightly stronger directional
    directionalLight.position.set(15, 30, 20); // Adjusted position
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048; // Increased shadow map resolution
    directionalLight.shadow.mapSize.height = 2048;
    const shadowCamSize = config.world.chunkSize * 3; // Adjust shadow camera frustum size
    directionalLight.shadow.camera.left = -shadowCamSize;
    directionalLight.shadow.camera.right = shadowCamSize;
    directionalLight.shadow.camera.top = shadowCamSize;
    directionalLight.shadow.camera.bottom = -shadowCamSize;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 100; // Increased shadow distance
    directionalLight.shadow.bias = -0.0005; // Adjust shadow bias to reduce artifacts
    scene.add(directionalLight);
    scene.add(directionalLight.target); // Target needs to be added to scene for updates

    // Debug helpers (optional)
    // const lightHelper = new THREE.DirectionalLightHelper(directionalLight, 5);
    // scene.add(lightHelper);
    // const shadowHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
    // scene.add(shadowHelper);

    return { scene, camera, renderer, directionalLight };
}
// --- Call Scene Setup ---
const { scene, camera, renderer, directionalLight } = setupSceneAndLighting();

// --- Game State ---
const room = new WebsimSocket(); // Available globally
const players = {}; // Store player controllers { clientId: PlayerController }
let localPlayerController = null;
const worldManager = new WorldManager(scene);
const loader = new GLTFLoader();
let playerModelData = null; // Store loaded { scene, animations }
const clock = new THREE.Clock();

// --- Asset Loading ---
loader.load(
    // Using Robot Expressive as a placeholder - Ensure it has Idle, Walk, Run, Jump, Dance animations named correctly
    'https://cdn.glitch.global/f58c6490-314b-4e6c-81a8-e46d08132a9f/robot_expressive.glb?v=1700789686613',
    (gltf) => {
        console.log("Player model loaded.");
        const model = gltf.scene;
        model.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = false; // Characters typically don't receive shadows on themselves

                // Ensure materials are standard for color changes and reasonable appearance
                if (node.material && !node.material.isMeshStandardMaterial) {
                    console.warn("Non-standard material found on model, attempting conversion:", node.material.type);
                    const oldMaterial = node.material;
                    node.material = new THREE.MeshStandardMaterial({
                        map: oldMaterial.map || null, // Keep texture if present
                        color: oldMaterial.color || 0xffffff, // Keep color if present
                        metalness: oldMaterial.metalness !== undefined ? oldMaterial.metalness : 0.1, // Default low metalness
                        roughness: oldMaterial.roughness !== undefined ? oldMaterial.roughness : 0.8, // Default high roughness
                    });
                    // Dispose old material if needed and possible:
                    // if(typeof oldMaterial.dispose === 'function') oldMaterial.dispose();
                } else if (node.material) {
                    // Adjust existing standard materials if needed
                    node.material.metalness = Math.min(node.material.metalness, 0.5); // Tone down metalness
                    node.material.roughness = Math.max(node.material.roughness, 0.3); // Ensure some roughness
                }
                if (node.material) node.material.needsUpdate = true;
            }
        });

        // Extract animations and map them using config names
        const animations = {};
        const availableAnimNames = gltf.animations.map(clip => clip.name.toLowerCase());
        console.log("Available animations in model:", availableAnimNames);

        for (const key in config.animation) {
            const targetNameLower = config.animation[key].toLowerCase();
            const foundClip = gltf.animations.find(clip => clip.name.toLowerCase() === targetNameLower);
            if (foundClip) {
                animations[key] = foundClip;
                console.log(`Mapped animation: ${key} -> ${foundClip.name}`);
            } else {
                console.warn(`Required animation "${key}" (looking for "${config.animation[key]}") not found in model!`);
            }
        }

        // Ensure jump animation doesn't loop by default in Three.js (it shouldn't, but safety check)
        if (animations.jump) {
            // THREE.AnimationClip doesn't have a direct loop property,
            // loop control is handled by AnimationAction (setLoop) in PlayerController
        }

        playerModelData = { scene: model, animations: animations };
        initializeGame(); // Start game logic only after model is loaded
    },
    undefined, // Progress callback (optional)
    (error) => {
        console.error('An error happened loading the player model:', error);
        // --- Enhanced Error Logging ---
        let errorDetails = 'Unknown error.';
        if (error instanceof ErrorEvent) {
            errorDetails = `ErrorEvent: ${error.message || 'No message'}`;
        } else if (error instanceof ProgressEvent && error.target) {
             // Check if it's an HTTP error event within ProgressEvent
            if (error.target instanceof XMLHttpRequest) {
                errorDetails = `HTTP Error: Status ${error.target.status} - ${error.target.statusText}`;
            } else {
                 errorDetails = `Network/Progress error. Target type: ${error.target.constructor.name}`;
            }
        } else if (error instanceof Error) {
            errorDetails = `Error: ${error.message}`;
        } else {
            try {
                // Attempt to stringify for generic objects, might fail
                errorDetails = JSON.stringify(error);
            } catch {
                errorDetails = 'Could not stringify error object.'
            }
        }
        console.error('Detailed Error Info:', errorDetails, error); // Log the original error object too
        // --- End Enhanced Error Logging ---

        // Display an error message to the user
        document.getElementById('scene-container').innerHTML = `
            <div class="flex items-center justify-center h-full">
                <p class="text-red-600 bg-white p-4 rounded shadow max-w-md text-center">
                    <b>Error loading character model.</b><br>
                    <span class="text-xs text-gray-600">(${errorDetails})</span><br>
                    Please try refreshing the page.
                </p>
            </div>`;
    }
);

// --- Initialization ---
async function initializeGame() {
    if (!playerModelData) {
        console.error("Attempted to initialize game before model loaded.");
        return;
    }

    try {
        await room.initialize();
        console.log("Websim room initialized.");
        console.log("My client ID:", room.clientId);
        console.log("Initial peers:", room.peers);
        console.log("Initial presence:", room.presence);
        console.log("Initial room state:", room.roomState); // Room state not used yet
    } catch (error) {
        console.error("Failed to initialize Websim room:", error);
        document.getElementById('scene-container').innerHTML = `
            <div class="flex items-center justify-center h-full">
                <p class="text-red-600 bg-white p-4 rounded shadow">Error connecting to server. Please refresh.</p>
            </div>`;
        return;
    }

    setupUIListeners();
    
    // Generate initial chunks around the starting position (0, 0)
    worldManager.updateChunks(0, 0);

    // Initialize local player
    const initialColor = document.getElementById('color-picker').value || config.character.color;
    const startPosition = { x: 0, y: config.character.height * 0.5, z: 0 }; // Start slightly above ground
    const initialPresence = {
        ...startPosition,
        qx: 0, qy: 0, qz: 0, qw: 1, // Initial rotation (identity quaternion)
        color: initialColor,
        animation: 'idle',
        stamina: config.character.stamina,
        running: false,
        dancing: false,
    };
    localPlayerController = addPlayer(room.clientId, initialPresence);

    if (localPlayerController) {
        localPlayerController.isLocalPlayer = true; // Mark as local player for input handling
        // Set initial quaternion for the local player model directly as getState uses model's current state
        localPlayerController.model.quaternion.set(initialPresence.qx, initialPresence.qy, initialPresence.qz, initialPresence.qw);
        room.updatePresence(localPlayerController.getState());
    } else {
        console.error("Failed to create local player controller!");
        // Display error
        document.getElementById('scene-container').innerHTML = `
            <div class="flex items-center justify-center h-full">
                <p class="text-red-600 bg-white p-4 rounded shadow">Error creating local player. Please refresh.</p>
            </div>`;
        return; // Cannot proceed
    }

    // Initialize existing players
    for (const clientId in room.presence) {
        if (clientId !== room.clientId) {
            addPlayer(clientId, room.presence[clientId]);
        }
    }

    // Handle presence updates (joins, leaves, state changes)
    room.subscribePresence((currentPresence) => {
        // console.log('Presence update:', currentPresence); // Debugging
        const activeClientIds = new Set(Object.keys(currentPresence));
        activeClientIds.add(room.clientId); // Ensure local client ID is considered active

        // Handle joins/updates
        for (const clientId in currentPresence) {
            if (clientId === room.clientId) continue; // Skip self, local player updates itself

            const playerData = currentPresence[clientId];
            if (!players[clientId]) {
                // New player joined
                addPlayer(clientId, playerData);
                console.log(`Player joined: ${room.peers[clientId]?.username || clientId}`);
            } else {
                // Update existing player state if they are not the local player
                players[clientId].setState(playerData);
            }
        }

        // Handle leaves (check existing players against current presence)
        for (const existingClientId in players) {
            if (existingClientId !== room.clientId && !currentPresence[existingClientId]) {
                const username = room.peers[existingClientId]?.username || existingClientId; // Get username before removing
                removePlayer(existingClientId);
                console.log(`Player left: ${username}`);
            }
        }
    });

    // Handle presence update requests (not used in this version, but good for future interactions)
    room.subscribePresenceUpdateRequests((updateRequest, fromClientId) => {
        console.log(`Received presence update request from ${fromClientId}:`, updateRequest);
        // Example: Handle a 'poke' request
        // if (updateRequest.type === 'poke' && localPlayerController) {
        //     localPlayerController.getPoked(); // Add a getPoked method to PlayerController
        //     room.updatePresence(localPlayerController.getState()); // Update presence if state changed
        // }
    });

    // Start game loop
    animate();

    // Start periodic presence update for the local player
    setInterval(() => {
        if (localPlayerController && localPlayerController.needsUpdate) {
            room.updatePresence(localPlayerController.getState());
            localPlayerController.needsUpdate = false; // Reset flag after sending
        }
    }, config.network.updateInterval);
}

// --- UI and Input Handling ---
function setupUIListeners() {
    const colorPicker = document.getElementById('color-picker');
    const danceButton = document.getElementById('dance-button');
    const runToggleButton = document.getElementById('run-toggle');
    const sceneContainer = document.getElementById('scene-container');

    colorPicker.addEventListener('input', (event) => {
        if (localPlayerController) {
            localPlayerController.setColor(event.target.value);
            // Color change immediately triggers needsUpdate in PlayerController
        }
    });

    danceButton.addEventListener('click', () => {
        if (localPlayerController) {
            localPlayerController.toggleDance();
            // State change triggers needsUpdate
        }
    });

    runToggleButton.addEventListener('click', () => {
        if (localPlayerController) {
            localPlayerController.toggleRun();
            const isRunning = localPlayerController.isRunning();
            runToggleButton.textContent = `Run: ${isRunning ? 'ON' : 'OFF'}`;
            runToggleButton.classList.toggle('bg-red-500', isRunning);
            runToggleButton.classList.toggle('hover:bg-red-700', isRunning);
            runToggleButton.classList.toggle('bg-green-500', !isRunning);
            runToggleButton.classList.toggle('hover:bg-green-700', !isRunning);
            // State change triggers needsUpdate
        }
    });

    // Keyboard controls for jump
    window.addEventListener('keydown', (event) => {
        // Ignore inputs if focus is on an input element like the color picker
        if (document.activeElement.tagName === 'INPUT') return;

        if (event.code === 'Space' && localPlayerController && !localPlayerController.isJumping() && !localPlayerController.isDancing()) {
            localPlayerController.jump();
            // State change triggers needsUpdate
        }
    });

    // Mouse controls for movement (Click on scene container)
    sceneContainer.addEventListener('click', (event) => {
        // Ignore clicks on UI elements overlaying the scene
        if (event.target !== sceneContainer) return;
        if (!localPlayerController || localPlayerController.isDancing()) return; // Ignore clicks if dancing

        const mouse = new THREE.Vector2(
            (event.clientX / window.innerWidth) * 2 - 1,
            -(event.clientY / window.innerHeight) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        const groundMeshes = worldManager.getGroundMeshes(); // Get targettable ground meshes
        if (groundMeshes.length === 0) {
            console.warn("Click raycast: No ground meshes found.");
            return; // No ground loaded yet?
        }

        const intersects = raycaster.intersectObjects(groundMeshes, false); // Don't test descendants

        if (intersects.length > 0) {
            // Find the closest intersection point on a ground mesh
            const targetPoint = intersects[0].point;
            localPlayerController.setMoveTarget(targetPoint);
            // Movement initiation triggers needsUpdate in PlayerController
        }
    });

    window.addEventListener('resize', onWindowResize, false);
}

// --- Player Management ---
function addPlayer(clientId, initialState) {
    if (players[clientId]) {
        console.warn(`Player ${clientId} already exists.`);
        // Optionally update state of existing player if needed?
        players[clientId].setState(initialState);
        return players[clientId]; // Return existing controller
    }
    if (!playerModelData || !playerModelData.scene || !playerModelData.animations) {
        console.error("Player model data not ready, cannot add player:", clientId);
        return null;
    }

    console.log(`Attempting to add player: ${clientId} with state:`, initialState);

    // Clone the base model scene graph. This ensures each player has unique Object3D instances.
    const newPlayerModel = playerModelData.scene.clone();
    const mixer = new THREE.AnimationMixer(newPlayerModel);

    // Ensure initialState has defaults if network state is missing fields
    const saneInitialState = {
        x: 0, y: config.character.height * 0.5, z: 0,
        qx: 0, qy: 0, qz: 0, qw: 1,
        color: config.character.color,
        animation: 'idle',
        stamina: config.character.stamina,
        running: false,
        dancing: false,
        ...initialState // Override defaults with provided state
    };

    const controller = new PlayerController(
        clientId,
        scene,
        newPlayerModel,
        mixer,
        playerModelData.animations, // Pass the mapped animations
        saneInitialState // Pass the initial state received from network/defaults
    );

    players[clientId] = controller;
    scene.add(newPlayerModel);
    console.log(`Added player ${clientId} to scene`);
    return controller;
}

function removePlayer(clientId) {
    if (players[clientId]) {
        players[clientId].removeFromScene(); // Handles removing model from scene and potential cleanup
        delete players[clientId];
        console.log(`Removed player ${clientId}`);
    } else {
        console.warn(`Tried to remove non-existent player: ${clientId}`);
    }
}

// --- Window Resize ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Game Loop ---
function animate() {
    requestAnimationFrame(animate);
    // Use Math.min to prevent excessively large delta values if the tab loses focus
    const delta = Math.min(clock.getDelta(), 0.1); // Cap delta time to 100ms (10fps min)

    // Update local player first
    if (localPlayerController) {
        localPlayerController.update(delta, worldManager);

        // --- Camera Follow Logic ---
        const playerPosition = localPlayerController.getPosition();
        const playerQuaternion = localPlayerController.model.quaternion; // Use model's actual rotation

        // Calculate camera offset based on player's rotation
        const cameraOffset = new THREE.Vector3(0, config.camera.offsetY, config.camera.offsetZ);
        // Apply player's rotation to the offset vector - This makes the camera orbit
        // cameraOffset.applyQuaternion(playerQuaternion); // Option 1: Camera orbits with player rotation
        // Option 2: Keep offset relative to world - simpler follow cam
        // (No applyQuaternion needed for option 2)

        // Calculate target camera position
        const targetCameraPosition = playerPosition.clone().add(cameraOffset);

        // Smoothly interpolate camera position
        camera.position.lerp(targetCameraPosition, 0.1); // Adjust lerp factor for smoothness (0.1 is quite smooth)

        // Calculate target lookAt point (slightly above player's feet/pivot)
        const targetLookAt = new THREE.Vector3(
            playerPosition.x,
            playerPosition.y + config.camera.lookAtOffsetY, // Look at point height offset
            playerPosition.z
        );

        // Make camera look at the target point
        camera.lookAt(targetLookAt);

        // Update world chunks based on local player position
        worldManager.updateChunks(playerPosition.x, playerPosition.z);

        // Update Stamina Bar UI
        const staminaPercent = (localPlayerController.getStamina() / config.character.stamina) * 100;
        const staminaBar = document.getElementById('stamina-bar');
        if (staminaBar) {
            staminaBar.style.width = `${Math.max(0, staminaPercent)}%`; // Ensure width doesn't go negative
        }
    }

    // Update other (remote) players
    for (const clientId in players) {
        if (clientId !== room.clientId) {
            players[clientId].update(delta, worldManager); // Pass delta for animation mixer and interpolation
        }
    }

    // Update directional light target to follow local player roughly for better shadow distribution
    if (localPlayerController) {
        const playerPos = localPlayerController.getPosition();
        // Update the light's target position (light looks AT this point)
        directionalLight.target.position.lerp(playerPos, 0.1); // Smoothly follow player
        // Important: Update the light's matrix world after changing position/target
        directionalLight.target.updateMatrixWorld();
    }

    // Render the scene
    renderer.render(scene, camera);
}