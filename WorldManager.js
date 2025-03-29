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