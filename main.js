import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { config } from './config.js';
import { PlayerController } from './PlayerController.js';
import { WorldManager } from './WorldManager.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.getElementById('scene-container').appendChild(renderer.domElement);

const room = new WebsimSocket(); // Available globally

const players = {}; // Store player controllers { clientId: PlayerController }
let localPlayerController = null;
const worldManager = new WorldManager(scene);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 7.5);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 50;
scene.add(directionalLight);

camera.position.z = 5;
camera.position.y = 10; // Start slightly elevated


const loader = new GLTFLoader();
let playerModel = null; // Store the loaded model
let playerAnimations = {}; // Store animations

loader.load(
    // Provided humanoid model URL - replace if needed
    'https://cdn.glitch.global/f58c6490-314b-4e6c-81a8-e46d08132a9f/robot_expressive.glb?v=1700789686613',
    async (gltf) => {
        playerModel = gltf.scene;
        playerModel.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
            }
        });

        // Extract animations
        gltf.animations.forEach(clip => {
            playerAnimations[clip.name.toLowerCase()] = clip;
        });

        console.log("Player model and animations loaded.");
        await initializeGame(); // Start game logic after model is loaded
    },
    undefined,
    (error) => {
        console.error('An error happened loading the player model:', error);
    }
);


async function initializeGame() {
    await room.initialize();
    console.log("Websim room initialized.");
    console.log("My client ID:", room.clientId);
    console.log("Initial peers:", room.peers);

    setupUIListeners();
    setupWorld();

    // Initialize local player
    const initialColor = document.getElementById('color-picker').value;
    localPlayerController = addPlayer(room.clientId, {
        x: 0,
        y: 0,
        z: 0,
        color: initialColor,
        animation: 'idle', // Initial state
        stamina: config.character.stamina,
        running: false,
        dancing: false,
    });
    localPlayerController.isLocalPlayer = true; // Mark as local player for input handling
    room.updatePresence(localPlayerController.getState());


    // Initialize existing players
    for (const clientId in room.presence) {
        if (clientId !== room.clientId) {
            addPlayer(clientId, room.presence[clientId]);
        }
    }

    // Handle presence updates (joins, leaves, state changes)
    room.subscribePresence((presence) => {
        // Handle joins/updates
        for (const clientId in presence) {
            if (clientId === room.clientId) continue; // Skip self

            if (!players[clientId]) {
                // New player joined
                addPlayer(clientId, presence[clientId]);
                console.log(`Player joined: ${room.peers[clientId]?.username || clientId}`);
            } else {
                // Update existing player state
                players[clientId].setState(presence[clientId]);
            }
        }

        // Handle leaves
        for (const clientId in players) {
            if (clientId !== room.clientId && !presence[clientId]) {
                removePlayer(clientId);
                console.log(`Player left: ${room.peers[clientId]?.username || clientId}`);
            }
        }
    });


     // Handle presence update requests (e.g., for future interactions)
    room.subscribePresenceUpdateRequests((updateRequest, fromClientId) => {
        console.log(`Received presence update request from ${fromClientId}:`, updateRequest);
        // Handle requests if needed (e.g., interactions like tagging)
    });

    // Start game loop
    animate();

    // Start periodic presence update
    setInterval(() => {
        if (localPlayerController && localPlayerController.needsUpdate) {
            room.updatePresence(localPlayerController.getState());
            localPlayerController.needsUpdate = false; // Reset flag
        }
    }, config.network.updateInterval);
}

function setupUIListeners() {
    const colorPicker = document.getElementById('color-picker');
    colorPicker.addEventListener('input', (event) => {
        if (localPlayerController) {
            localPlayerController.setColor(event.target.value);
            localPlayerController.needsUpdate = true; // Mark for update
        }
    });

    const danceButton = document.getElementById('dance-button');
    danceButton.addEventListener('click', () => {
        if (localPlayerController) {
            localPlayerController.toggleDance();
            localPlayerController.needsUpdate = true; // Mark for update
        }
    });

    const runToggleButton = document.getElementById('run-toggle');
    runToggleButton.addEventListener('click', () => {
        if (localPlayerController) {
            localPlayerController.toggleRun();
            runToggleButton.textContent = `Run: ${localPlayerController.isRunning() ? 'ON' : 'OFF'}`;
            localPlayerController.needsUpdate = true; // Mark for update
        }
    });

     // Keyboard controls for jump
    window.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && localPlayerController && !localPlayerController.isJumping()) {
            localPlayerController.jump();
            localPlayerController.needsUpdate = true; // Mark for update
        }
    });

    // Mouse controls for movement
    window.addEventListener('click', (event) => {
         if (!localPlayerController || event.target.tagName === 'BUTTON' || event.target.tagName === 'INPUT') return; // Ignore UI clicks

         const mouse = new THREE.Vector2(
             (event.clientX / window.innerWidth) * 2 - 1,
            -(event.clientY / window.innerHeight) * 2 + 1
         );
         const raycaster = new THREE.Raycaster();
         raycaster.setFromCamera(mouse, camera);

         const groundMesh = worldManager.getGroundMeshes(); // Get targettable ground meshes
         const intersects = raycaster.intersectObjects(groundMesh);

         if (intersects.length > 0) {
             const targetPoint = intersects[0].point;
             localPlayerController.setMoveTarget(targetPoint);
             localPlayerController.needsUpdate = true; // Mark for update
         }
     });

    window.addEventListener('resize', onWindowResize, false);
}

function setupWorld() {
    worldManager.generateInitialChunks(0, 0); // Start generating around origin
}


function addPlayer(clientId, initialState) {
    if (!playerModel) {
        console.error("Player model not loaded yet, cannot add player.");
        return null;
    }

    const newPlayerModel = playerModel.clone();
    const mixer = new THREE.AnimationMixer(newPlayerModel);
    const controller = new PlayerController(clientId, scene, newPlayerModel, mixer, playerAnimations, initialState);
    players[clientId] = controller;
    scene.add(newPlayerModel);
    controller.setState(initialState); // Apply initial state (color, position, etc.)
    console.log(`Added player ${clientId} at`, initialState);
    return controller;
}

function removePlayer(clientId) {
    if (players[clientId]) {
        players[clientId].removeFromScene();
        delete players[clientId];
        console.log(`Removed player ${clientId}`);
    }
}


function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    // Update local player first
    if (localPlayerController) {
        localPlayerController.update(delta, worldManager);
        // Camera follow local player
        const playerPosition = localPlayerController.getPosition();
        camera.position.x = playerPosition.x;
        camera.position.y = playerPosition.y + 10; // Camera height offset
        camera.position.z = playerPosition.z + 15; // Camera distance offset
        camera.lookAt(playerPosition.x, playerPosition.y + 1, playerPosition.z); // Look slightly above feet

        // Update world based on local player position
        worldManager.updateChunks(playerPosition.x, playerPosition.z);

        // Update Stamina Bar
        const staminaPercent = (localPlayerController.getStamina() / config.character.stamina) * 100;
        const staminaBar = document.getElementById('stamina-bar');
        staminaBar.style.width = `${staminaPercent}%`;
    }

    // Update other players
    for (const clientId in players) {
        if (clientId !== room.clientId) {
            players[clientId].update(delta, worldManager);
        }
    }


    renderer.render(scene, camera);
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { config } from './config.js';
import { PlayerController } from './PlayerController.js';
import { WorldManager } from './WorldManager.js';

// --- Basic Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue background
scene.fog = new THREE.Fog(0x87ceeb, config.world.chunkSize * (config.world.renderDistance - 1), config.world.chunkSize * (config.world.renderDistance + 1));

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, config.world.chunkSize * (config.world.renderDistance + 2));
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('scene-container').appendChild(renderer.domElement);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(15, 30, 20);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
const shadowCamSize = config.world.chunkSize * 3;
directionalLight.shadow.camera.left = -shadowCamSize;
directionalLight.shadow.camera.right = shadowCamSize;
directionalLight.shadow.camera.top = shadowCamSize;
directionalLight.shadow.camera.bottom = -shadowCamSize;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 100;
scene.add(directionalLight);
// const lightHelper = new THREE.DirectionalLightHelper(directionalLight, 5);
// scene.add(lightHelper);
// const shadowHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
// scene.add(shadowHelper);


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
    // Using Robot Expressive as a placeholder - needs Idle, Walk, Run, Jump, Dance
    'https://cdn.glitch.global/f58c6490-314b-4e6c-81a8-e46d08132a9f/robot_expressive.glb?v=1700789686613',
    (gltf) => {
        console.log("Player model loaded.");
        const model = gltf.scene;
        model.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
                // Ensure materials are standard for color changes
                 if (!node.material.isMeshStandardMaterial) {
                     const oldMaterial = node.material;
                     node.material = new THREE.MeshStandardMaterial({
                         map: oldMaterial.map, // Keep texture if present
                         metalness: oldMaterial.metalness !== undefined ? oldMaterial.metalness : 0.5,
                         roughness: oldMaterial.roughness !== undefined ? oldMaterial.roughness : 0.5,
                     });
                     // Dispose old material if needed: oldMaterial.dispose();
                 } else {
                    // Make sure existing standard materials are not fully metallic/rough
                    node.material.metalness = Math.min(node.material.metalness, 0.8);
                    node.material.roughness = Math.max(node.material.roughness, 0.2);
                 }
                 node.material.needsUpdate = true;
            }
        });

        // Extract animations and map them using config names
        const animations = {};
        gltf.animations.forEach(clip => {
            for (const key in config.animation) {
                if (config.animation[key].toLowerCase() === clip.name.toLowerCase()) {
                    animations[key] = clip;
                    console.log(`Mapped animation: ${key} -> ${clip.name}`);
                    break; // Move to next clip once mapped
                }
            }
        });

        // Check for missing required animations
        ['idle', 'walk', 'run', 'jump', 'dance'].forEach(key => {
            if (!animations[key]) {
                 console.warn(`Required animation "${key}" (mapped as "${config.animation[key]}") not found in model!`);
            } else {
                // Ensure jump animation doesn't loop
                if (key === 'jump') {
                    animations[key].loop = THREE.LoopOnce;
                }
            }
        });


        playerModelData = { scene: model, animations: animations };
        initializeGame(); // Start game logic only after model is loaded
    },
    undefined, // Progress callback (optional)
    (error) => {
        console.error('An error happened loading the player model:', error);
        // Display an error message to the user?
        document.getElementById('scene-container').innerHTML = '<p class="text-red-500 text-center p-8">Error loading character model. Please refresh.</p>';
    }
);

// --- Initialization ---
async function initializeGame() {
    if (!playerModelData) {
        console.error("Attempted to initialize game before model loaded.");
        return;
    }

    await room.initialize();
    console.log("Websim room initialized.");
    console.log("My client ID:", room.clientId);
    console.log("Initial peers:", room.peers);
    console.log("Initial presence:", room.presence);
    console.log("Initial room state:", room.roomState);

    setupUIListeners();
    setupWorld();

    // Initialize local player
    const initialColor = document.getElementById('color-picker').value || config.character.color;
    const startPosition = { x: 0, y: config.character.height * 0.5, z: 0 }; // Start slightly above ground
    localPlayerController = addPlayer(room.clientId, {
        ...startPosition,
        color: initialColor,
        animation: 'idle',
        stamina: config.character.stamina,
        running: false,
        dancing: false,
    });
    if (localPlayerController) {
        localPlayerController.isLocalPlayer = true; // Mark as local player for input handling
        room.updatePresence(localPlayerController.getState());
    } else {
        console.error("Failed to create local player controller!");
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
        // Handle joins/updates
        for (const clientId in currentPresence) {
            if (clientId === room.clientId) continue; // Skip self

            if (!players[clientId]) {
                // New player joined
                addPlayer(clientId, currentPresence[clientId]);
                console.log(`Player joined: ${room.peers[clientId]?.username || clientId}`);
            } else {
                // Update existing player state if they are not the local player
                players[clientId].setState(currentPresence[clientId]);
            }
        }

        // Handle leaves
        for (const existingClientId in players) {
            if (existingClientId !== room.clientId && !currentPresence[existingClientId]) {
                const username = room.peers[existingClientId]?.username || existingClientId;
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
    colorPicker.addEventListener('input', (event) => {
        if (localPlayerController) {
            localPlayerController.setColor(event.target.value);
            // Color change immediately triggers needsUpdate in PlayerController
        }
    });

    const danceButton = document.getElementById('dance-button');
    danceButton.addEventListener('click', () => {
        if (localPlayerController) {
            localPlayerController.toggleDance();
            // State change triggers needsUpdate
        }
    });

    const runToggleButton = document.getElementById('run-toggle');
    runToggleButton.addEventListener('click', () => {
        if (localPlayerController) {
            localPlayerController.toggleRun();
            runToggleButton.textContent = `Run: ${localPlayerController.isRunning() ? 'ON' : 'OFF'}`;
             runToggleButton.classList.toggle('bg-red-500', localPlayerController.isRunning());
             runToggleButton.classList.toggle('hover:bg-red-700', localPlayerController.isRunning());
             runToggleButton.classList.toggle('bg-green-500', !localPlayerController.isRunning());
             runToggleButton.classList.toggle('hover:bg-green-700', !localPlayerController.isRunning());
            // State change triggers needsUpdate
        }
    });

     // Keyboard controls for jump
    window.addEventListener('keydown', (event) => {
         // Ignore inputs if focus is on color picker
         if (document.activeElement === colorPicker) return;

        if (event.code === 'Space' && localPlayerController && !localPlayerController.isJumping() && !localPlayerController.isDancing()) {
            localPlayerController.jump();
            // State change triggers needsUpdate
        }
    });

    // Mouse controls for movement (Click on scene container)
    const sceneContainer = document.getElementById('scene-container');
    sceneContainer.addEventListener('click', (event) => {
        if (!localPlayerController || localPlayerController.isDancing()) return; // Ignore clicks if dancing

        const mouse = new THREE.Vector2(
            (event.clientX / window.innerWidth) * 2 - 1,
            -(event.clientY / window.innerHeight) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        const groundMeshes = worldManager.getGroundMeshes(); // Get targettable ground meshes
        if (groundMeshes.length === 0) return; // No ground loaded yet?

        const intersects = raycaster.intersectObjects(groundMeshes);

        if (intersects.length > 0) {
            const targetPoint = intersects[0].point;
            localPlayerController.setMoveTarget(targetPoint);
            // Movement initiation triggers needsUpdate
        }
    });

    window.addEventListener('resize', onWindowResize, false);
}

function setupWorld() {
    // Generate initial chunks around the starting position (0, 0)
    worldManager.updateChunks(0, 0);
}


// --- Player Management ---
function addPlayer(clientId, initialState) {
    if (players[clientId]) {
        console.warn(`Player ${clientId} already exists.`);
        return players[clientId]; // Return existing controller
    }
    if (!playerModelData || !playerModelData.scene || !playerModelData.animations) {
        console.error("Player model data not ready, cannot add player:", clientId);
        return null;
    }

    console.log(`Attempting to add player: ${clientId} with state:`, initialState);

    const newPlayerModel = playerModelData.scene.clone(); // Clone the base model
    const mixer = new THREE.AnimationMixer(newPlayerModel);

    const controller = new PlayerController(
        clientId,
        scene,
        newPlayerModel,
        mixer,
        playerModelData.animations, // Pass the mapped animations
        initialState // Pass the initial state received from network/defaults
    );

    players[clientId] = controller;
    scene.add(newPlayerModel);
    console.log(`Added player ${clientId} to scene`);
    return controller;
}

function removePlayer(clientId) {
    if (players[clientId]) {
        players[clientId].removeFromScene();
        delete players[clientId];
        console.log(`Removed player ${clientId}`);
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
    const delta = Math.min(clock.getDelta(), 0.1); // Cap delta time to prevent physics glitches

    // Update local player first
    if (localPlayerController) {
        localPlayerController.update(delta, worldManager);

        // Camera follow local player smoothly
        const playerPosition = localPlayerController.getPosition();
        const targetCameraPosition = new THREE.Vector3(
            playerPosition.x,
            playerPosition.y + config.camera.offsetY,
            playerPosition.z + config.camera.offsetZ
        );
        camera.position.lerp(targetCameraPosition, 0.1); // Smooth camera movement

        const targetLookAt = new THREE.Vector3(
             playerPosition.x,
             playerPosition.y + config.camera.lookAtOffsetY,
             playerPosition.z
         );
        camera.lookAt(targetLookAt);


        // Update world based on local player position
        worldManager.updateChunks(playerPosition.x, playerPosition.z);

        // Update Stamina Bar UI
        const staminaPercent = (localPlayerController.getStamina() / config.character.stamina) * 100;
        const staminaBar = document.getElementById('stamina-bar');
        if (staminaBar) {
            staminaBar.style.width = `${Math.max(0, staminaPercent)}%`;
        }
    }

    // Update other players
    for (const clientId in players) {
        if (clientId !== room.clientId) {
            players[clientId].update(delta, worldManager);
        }
    }

    // Update directional light target to follow player roughly for better shadows
    if (localPlayerController) {
        const playerPos = localPlayerController.getPosition();
        directionalLight.target.position.set(playerPos.x, 0, playerPos.z);
        directionalLight.target.updateMatrixWorld(); // Important!
    }


    renderer.render(scene, camera);
}

