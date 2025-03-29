export const config = {
    character: {
        speed: 5, // Units per second
        runMultiplier: 2,
        jumpHeight: 8,
        gravity: -20, // Units per second squared
        stamina: 100,
        staminaDrainRate: 20, // Units per second while running
        staminaRegenRate: 10, // Units per second while not running
    },
    world: {
        chunkSize: 16,
        renderDistance: 5, // Chunks around the player
    },
    network: {
        updateInterval: 100, // ms
    }
};

export const config = {
    character: {
        height: 1.8, // Approximate height for camera and positioning
        walkSpeed: 3.5, // Units per second
        runSpeed: 7.0, // Units per second
        jumpForce: 7.0, // Initial upward velocity
        gravity: -18.0, // Units per second squared
        stamina: 100,
        staminaDrainRate: 15, // Units per second while running
        staminaRegenRate: 10, // Units per second while not running/jumping
        jumpStaminaCost: 5, // Stamina cost per jump
        color: '#ff0000', // Default color
        turnSpeed: 10.0, // Radians per second for turning towards movement
    },
    world: {
        chunkSize: 32, // Size of each terrain chunk
        renderDistance: 4, // Chunks around the player (renderDistance x 2 + 1)^2 chunks loaded
    },
    camera: {
        offsetY: 8, // Camera height above player pivot
        offsetZ: 12, // Camera distance behind player
        lookAtOffsetY: 1.0, // Point camera slightly above player pivot
    },
    network: {
        updateInterval: 50, // ms - Send updates more frequently for smoother sync
    },
    animation: {
        // Map model animation names to standard names used in code
        idle: 'Idle',
        walk: 'Walk',
        run: 'Run',
        jump: 'Jump', // Should be a short animation played once
        dance: 'Dance', // Should be a looping animation
        fadeDuration: 0.2, // Seconds for cross-fade between animations
    }
};

