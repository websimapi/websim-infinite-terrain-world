import * as THREE from 'three';
import { config } from './config.js';

export class WorldManager {
    constructor(scene) {
        this.scene = scene;
        this.chunkSize = config.world.chunkSize;
        this.renderDistance = config.world.renderDistance; // In chunks
        this.chunks = {}; // Store chunks: { 'x_z': Mesh }
        this.loadedChunkCoords = new Set(); // Keep track of loaded chunk coordinates as 'x_z' strings

        // Shared ground material
        this.groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x80a080, // Greenish ground
            // wireframe: true, // For debugging chunk borders
        });

        // Shared ground geometry (plane)
        this.groundGeometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, 1, 1);
        this.groundGeometry.rotateX(-Math.PI / 2); // Rotate to be horizontal
    }

    getChunkCoords(x, z) {
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(z / this.chunkSize);
        return { x: chunkX, z: chunkZ };
    }

    getChunkKey(chunkX, chunkZ) {
        return `${chunkX}_${chunkZ}`;
    }

    generateChunk(chunkX, chunkZ) {
        const key = this.getChunkKey(chunkX, chunkZ);
        if (this.chunks[key]) {
            return; // Already exists
        }

        const chunkMesh = new THREE.Mesh(this.groundGeometry, this.groundMaterial);
        chunkMesh.position.set(
            chunkX * this.chunkSize + this.chunkSize / 2,
            0,
            chunkZ * this.chunkSize + this.chunkSize / 2
        );
        chunkMesh.receiveShadow = true; // Allow ground to receive shadows
        this.chunks[key] = chunkMesh;
        this.scene.add(chunkMesh);
        this.loadedChunkCoords.add(key);
        // console.log(`Generated chunk: ${key}`);
    }

    removeChunk(chunkX, chunkZ) {
        const key = this.getChunkKey(chunkX, chunkZ);
        if (this.chunks[key]) {
            this.scene.remove(this.chunks[key]);
            // Consider disposing geometry/material if they are not shared
            delete this.chunks[key];
            this.loadedChunkCoords.delete(key);
            // console.log(`Removed chunk: ${key}`);
        }
    }

    updateChunks(playerX, playerZ) {
        const currentChunkCoords = this.getChunkCoords(playerX, playerZ);
        const chunksToLoad = new Set();

        // Determine required chunks based on render distance
        for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
            for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
                const chunkX = currentChunkCoords.x + x;
                const chunkZ = currentChunkCoords.z + z;
                const key = this.getChunkKey(chunkX, chunkZ);
                chunksToLoad.add(key);

                if (!this.loadedChunkCoords.has(key)) {
                    this.generateChunk(chunkX, chunkZ);
                }
            }
        }

        // Determine chunks to unload
        const chunksToUnload = new Set(this.loadedChunkCoords);
        chunksToLoad.forEach(key => {
            chunksToUnload.delete(key); // Remove required chunks from the unload list
        });

        // Unload chunks that are no longer needed
        chunksToUnload.forEach(key => {
            const [chunkX, chunkZ] = key.split('_').map(Number);
            this.removeChunk(chunkX, chunkZ);
        });
    }

     generateInitialChunks(startX, startZ) {
        const startChunkCoords = this.getChunkCoords(startX, startZ);
        this.updateChunks(startChunkCoords.x * this.chunkSize, startChunkCoords.z * this.chunkSize);
    }

    // Get all ground meshes for raycasting (e.g., click-to-move)
    getGroundMeshes() {
        return Object.values(this.chunks);
    }
}
`````` index.html
``` index.html
<!DOCTYPE html>
<html>
<head>
    <title>Infinite Terrain World</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css">
    <link rel="stylesheet" href="style.css">
    <script type="importmap">
    {
      "imports": {
        "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
        "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
      }
    }
  </script>
</head>
<body class="overflow-hidden bg-blue-100">
    <div id="scene-container" class="absolute top-0 left-0 w-full h-full cursor-pointer"></div>
    <div class="absolute top-0 left-0 p-4 bg-white bg-opacity-75 rounded-br-lg">
        <label for="color-picker" class="block mb-1 text-sm font-medium text-gray-900">Character Color:</label>
        <input type="color" id="color-picker" value="#ff0000" class="p-1 h-10 w-14 block bg-white border border-gray-300 cursor-pointer rounded-lg disabled:opacity-50 disabled:pointer-events-none">
    </div>
    <div class="absolute bottom-4 left-4 flex space-x-2">
         <button id="dance-button" class="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded transition-colors">
            Dance
        </button>
         <button id="run-toggle" class="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition-colors w-28 text-center">
            Run: OFF
        </button>
    </div>
     <div id="stamina-bar-container" title="Stamina (Run/Jump)" class="absolute bottom-20 left-4 w-48 h-4 bg-gray-300 rounded border border-gray-400">
        <div id="stamina-bar" class="h-full bg-yellow-400 rounded transition-all duration-100 ease-linear"></div>
    </div>
    <!-- Instructions -->
    <div class="absolute top-4 right-4 p-3 bg-white bg-opacity-75 rounded-lg text-sm text-gray-700">
        <b>Controls:</b><br>
        - Click ground: Move<br>
        - Spacebar: Jump<br>
        - Run Button: Toggle run<br>
        - Dance Button: Toggle dance<br>
        - Color Picker: Change color
    </div>
    <script type="module" src="main.js"></script>
</body>
</html>

import * as THREE from 'three';
import { config } from './config.js';

export class WorldManager {
    constructor(scene) {
        this.scene = scene;
        this.chunkSize = config.world.chunkSize;
        this.renderDistance = config.world.renderDistance; // In chunks
        this.chunks = {}; // Store chunks: { 'x_z': Mesh }
        this.loadedChunkCoords = new Set(); // Keep track of loaded chunk coordinates as 'x_z' strings

        // Shared ground material
        this.groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x90b080, // Slightly different green
            roughness: 0.9,
            metalness: 0.1,
            // side: THREE.DoubleSide // Enable if camera can go below ground
        });

        // Shared ground geometry (plane)
        this.groundGeometry = new THREE.PlaneGeometry(
            this.chunkSize,
            this.chunkSize,
            1, // Reduce segments for performance on flat terrain
            1
        );
        this.groundGeometry.rotateX(-Math.PI / 2); // Rotate to be horizontal (Y-up)

        this.lastPlayerChunkX = null;
        this.lastPlayerChunkZ = null;
    }

    getChunkCoords(worldX, worldZ) {
        const chunkX = Math.floor(worldX / this.chunkSize);
        const chunkZ = Math.floor(worldZ / this.chunkSize);
        return { x: chunkX, z: chunkZ };
    }

    getChunkKey(chunkX, chunkZ) {
        return `${chunkX}_${chunkZ}`;
    }

    generateChunk(chunkX, chunkZ) {
        const key = this.getChunkKey(chunkX, chunkZ);
        if (this.chunks[key]) {
            console.warn(`Chunk ${key} already exists, skipping generation.`);
            return; // Already exists
        }

        // Use InstancedMesh or merge geometry later if performance becomes an issue
        const chunkMesh = new THREE.Mesh(this.groundGeometry, this.groundMaterial);
        chunkMesh.position.set(
            chunkX * this.chunkSize + this.chunkSize / 2, // Center mesh in chunk
            0, // Position at Y=0
            chunkZ * this.chunkSize + this.chunkSize / 2
        );
        chunkMesh.receiveShadow = true; // Allow ground to receive shadows
        chunkMesh.name = `chunk_${key}`; // For debugging

        this.chunks[key] = chunkMesh;
        this.scene.add(chunkMesh);
        this.loadedChunkCoords.add(key);
        // console.log(`Generated chunk: ${key} at ${chunkMesh.position.x}, ${chunkMesh.position.z}`);
    }

    removeChunk(chunkX, chunkZ) {
        const key = this.getChunkKey(chunkX, chunkZ);
        const chunkMesh = this.chunks[key];
        if (chunkMesh) {
            this.scene.remove(chunkMesh);
            // Geometry and Material are shared, DO NOT dispose them here.
            delete this.chunks[key];
            this.loadedChunkCoords.delete(key);
            // console.log(`Removed chunk: ${key}`);
        } else {
            // console.warn(`Attempted to remove non-existent chunk: ${key}`);
        }
    }

    updateChunks(playerX, playerZ) {
        const currentChunkCoords = this.getChunkCoords(playerX, playerZ);

        // Only update chunks if the player has moved to a new chunk
        if (currentChunkCoords.x === this.lastPlayerChunkX && currentChunkCoords.z === this.lastPlayerChunkZ) {
            return;
        }
         // console.log(`Player moved to chunk ${currentChunkCoords.x}, ${currentChunkCoords.z}. Updating chunks.`);
        this.lastPlayerChunkX = currentChunkCoords.x;
        this.lastPlayerChunkZ = currentChunkCoords.z;


        const chunksToLoad = new Set();
        const loadRadius = this.renderDistance; // Use render distance directly as radius

        // Determine required chunks based on render distance
        for (let x = -loadRadius; x <= loadRadius; x++) {
            for (let z = -loadRadius; z <= loadRadius; z++) {
                // Optional: Use circular radius check instead of square
                 // if (x*x + z*z > loadRadius * loadRadius) continue;

                const chunkX = currentChunkCoords.x + x;
                const chunkZ = currentChunkCoords.z + z;
                const key = this.getChunkKey(chunkX, chunkZ);
                chunksToLoad.add(key); // Add to the set of chunks that *should* be loaded

                // Generate if it's not currently loaded
                if (!this.loadedChunkCoords.has(key)) {
                    this.generateChunk(chunkX, chunkZ);
                }
            }
        }

        // Determine chunks to unload: iterate through currently loaded chunks
        // and check if they are in the required set (chunksToLoad).
        const chunksToRemove = [];
        this.loadedChunkCoords.forEach(loadedKey => {
            if (!chunksToLoad.has(loadedKey)) {
                chunksToRemove.push(loadedKey);
            }
        });

        // Unload chunks that are no longer needed
        chunksToRemove.forEach(keyToRemove => {
            const [chunkX, chunkZ] = keyToRemove.split('_').map(Number);
            this.removeChunk(chunkX, chunkZ);
        });
    }

    // Get all ground meshes currently loaded (e.g., for raycasting)
    getGroundMeshes() {
        return Object.values(this.chunks);
    }
}

