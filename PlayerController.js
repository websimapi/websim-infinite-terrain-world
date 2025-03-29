import * as THREE from 'three';
import { config } from './config.js';

export class PlayerController {
    constructor(clientId, scene, model, mixer, animations, initialState) {
        this.clientId = clientId;
        this.scene = scene;
        this.model = model;
        this.mixer = mixer;
        this.animations = animations; // Already mapped {idle: Clip, walk: Clip, ...}

        // Default state merged with initial state
        this.state = {
            x: 0,
            y: config.character.height * 0.5, // Start slightly above ground
            z: 0,
            color: config.character.color,
            animation: 'idle',
            stamina: config.character.stamina,
            running: false,
            dancing: false,
            ...initialState // Override defaults with provided state
        };

        this.isLocalPlayer = false;
        this.velocity = new THREE.Vector3();
        this.moveTarget = null; // Target position for click-to-move (Vector3)
        this.currentAction = null; // Currently playing AnimationAction
        this.needsUpdate = false; // Flag for network update throttling
        this.onGround = true;
        this.targetQuaternion = new THREE.Quaternion().setFromEuler(this.model.rotation); // Target rotation

        // Interpolation for remote players
        this.networkPosition = new THREE.Vector3(this.state.x, this.state.y, this.state.z);
        this.networkQuaternion = new THREE.Quaternion().copy(this.model.quaternion);
        this.lastNetworkUpdateTime = 0;

        // Initialize 3D model state
        this.model.position.set(this.state.x, this.state.y, this.state.z);
        this.setColor(this.state.color);
        this._playAnimation(this.state.animation, 0); // Start initial animation immediately

        // Add a pivot point helper for debugging camera target
        // const pivotGeometry = new THREE.SphereGeometry(0.1);
        // const pivotMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        // this.pivotHelper = new THREE.Mesh(pivotGeometry, pivotMaterial);
        // this.model.add(this.pivotHelper); // Add directly to model seems wrong, add to scene at model pos?
        // Or just use the model's origin.
    }

    getState() {
        // Return only the data needed for synchronization
        return {
            x: this.model.position.x,
            y: this.model.position.y,
            z: this.model.position.z,
            qx: this.model.quaternion.x, // Send quaternion for rotation
            qy: this.model.quaternion.y,
            qz: this.model.quaternion.z,
            qw: this.model.quaternion.w,
            color: this.state.color,
            animation: this.state.animation,
            stamina: Math.round(this.state.stamina), // Send rounded stamina
            running: this.state.running,
            dancing: this.state.dancing,
        };
    }

    setState(newState) {
        // Update state received from the network for remote players

        // Position & Rotation Interpolation Target
        this.networkPosition.set(newState.x, newState.y, newState.z);
        if (newState.qx !== undefined) { // Check if quaternion data exists
            this.networkQuaternion.set(newState.qx, newState.qy, newState.qz, newState.qw);
        }
        this.lastNetworkUpdateTime = Date.now();

        // Direct State Updates
        if (this.state.color !== newState.color) {
            this.setColor(newState.color); // Update color immediately
        }
        if (this.state.animation !== newState.animation) {
            this._playAnimation(newState.animation); // Transition animation
        }

        // Store other state variables directly (stamina, running, dancing)
        // These might be used for visual cues on remote players later (e.g., effects)
        this.state.stamina = newState.stamina;
        this.state.running = newState.running;
        this.state.dancing = newState.dancing;

        // Store the raw state as well, might be useful
        Object.assign(this.state, newState);
    }

    setColor(colorHex) {
        if (this.state.color === colorHex) return; // No change needed

        this.state.color = colorHex;
        this.model.traverse((child) => {
            if (child.isMesh && child.material && child.material.isMeshStandardMaterial) {
                child.material.color.set(colorHex);
            }
        });
        if (this.isLocalPlayer) {
            this.needsUpdate = true; // Mark for network update
        }
    }

    setMoveTarget(targetPoint) {
        if (this.state.dancing) return; // Cannot move while dancing
        this.moveTarget = targetPoint.clone();
        // Keep target Y flat for ground movement planning, actual Y handled by gravity/collision
        this.moveTarget.y = this.model.position.y;
        if (this.isLocalPlayer) {
            this.needsUpdate = true; // Moving state changed potentially
        }
    }

    jump() {
        if (!this.isLocalPlayer || this.state.dancing || !this.onGround || this.state.stamina < config.character.jumpStaminaCost) {
            return; // Can only jump if local, not dancing, on ground, and have stamina
        }

        this.velocity.y = config.character.jumpForce;
        this.onGround = false;
        this.state.stamina -= config.character.jumpStaminaCost;
        this._playAnimation('jump', 0.1, false); // Play jump animation once, quick transition
        this.needsUpdate = true;
        // console.log("Jump! Stamina:", this.state.stamina);
    }

    toggleRun() {
        if (!this.isLocalPlayer || this.state.dancing) return; // Can only toggle run if local and not dancing

        this.state.running = !this.state.running;
        if (!this.state.running) {
            // If stopping running, ensure animation updates correctly in the next frame
            // The update loop will handle switching from 'run' to 'walk' or 'idle' based on velocity
        }
        this.needsUpdate = true;
        // console.log("Toggle Run:", this.state.running);
    }

    isRunning() {
        return this.state.running;
    }

    isJumping() {
        // Considered jumping if not on ground OR if vertical velocity is positive
        return !this.onGround || this.velocity.y > 0.1;
    }

    isDancing() {
        return this.state.dancing;
    }

    getStamina() {
        return this.state.stamina;
    }

    toggleDance() {
        if (!this.isLocalPlayer) return;

        this.state.dancing = !this.state.dancing;
        if (this.state.dancing) {
            this._playAnimation('dance'); // Smooth transition to dance
            this.moveTarget = null; // Stop moving if starting to dance
            this.velocity.x = 0; // Stop horizontal velocity
            this.velocity.z = 0;
            if (this.state.running) {
                this.state.running = false; // Stop running if dancing starts
                // Update run toggle button text externally if needed
                const runToggleButton = document.getElementById('run-toggle');
                if (runToggleButton) {
                    runToggleButton.textContent = 'Run: OFF';
                    runToggleButton.classList.remove('bg-red-500', 'hover:bg-red-700');
                    runToggleButton.classList.add('bg-green-500', 'hover:bg-green-700');
                }
            }
        } else {
            // If stopping dance, transition back to idle. Movement/running will override if needed.
            this._playAnimation('idle');
        }
        this.needsUpdate = true;
        // console.log("Toggle Dance:", this.state.dancing);
    }

    update(delta, worldManager) {
        if (this.isLocalPlayer) {
            this._updateLocal(delta);
        } else {
            this._updateRemote(delta);
        }

        // --- Apply Gravity & Vertical Movement (Only for Local Player) ---
        // Remote player Y position is driven by interpolation from network state
        if (this.isLocalPlayer) {
            this.velocity.y += config.character.gravity * delta;
            this.model.position.y += this.velocity.y * delta;

            // --- Ground Collision (Simple Y=0) ---
            const groundY = 0; // Assume flat ground at Y=0
            if (this.model.position.y <= groundY) {
                this.model.position.y = groundY;
                this.velocity.y = Math.max(0, this.velocity.y); // Stop downward velocity, allow bounces? set to 0 to be safe.
                if (!this.onGround) {
                    // Just landed
                    if (this.state.animation === 'jump') {
                        // If landing after jump, switch to idle/walk/run based on current intention
                        const speed = new THREE.Vector3(this.velocity.x, 0, this.velocity.z).length();
                        const targetAnim = speed > 0.1 ? (this.state.running ? 'run' : 'walk') : 'idle';
                        this._playAnimation(targetAnim);
                    }
                }
                this.onGround = true;
            } else {
                this.onGround = false;
                // Maybe switch to jump/fall animation if falling significantly?
                // if (this.velocity.y < -1 && this.state.animation !== 'jump' && !this.state.dancing) {
                //     this._playAnimation('jump', 0.3, false); // Use jump as a general falling anim for now
                // }
            }
        }

        // --- Update Animation Mixer (Always) ---
        this.mixer.update(delta);
    }

    _updateLocal(delta) {
        const { walkSpeed, runSpeed, staminaDrainRate, staminaRegenRate, jumpStaminaCost, stamina: maxStamina, turnSpeed } = config.character;

        let desiredVelocity = new THREE.Vector3();
        let targetAnimation = this.state.animation; // Default to current
        let isMoving = false;

        // --- Movement Calculation ---
        if (this.moveTarget && !this.state.dancing) {
            const direction = this.moveTarget.clone().sub(this.model.position);
            direction.y = 0; // Ignore Y for distance and direction calculation
            const distance = direction.length();

            const effectiveSpeed = (this.state.running && this.state.stamina > 0) ? runSpeed : walkSpeed;

            if (distance > 0.1) { // Movement threshold
                isMoving = true;
                direction.normalize();
                desiredVelocity.copy(direction).multiplyScalar(effectiveSpeed);

                // --- Rotation ---
                if (desiredVelocity.lengthSq() > 0.01) { // Only rotate if moving significantly
                    const angle = Math.atan2(direction.x, direction.z);
                    this.targetQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                }

                // --- Stamina Drain ---
                if (this.state.running && this.state.stamina > 0) {
                    let staminaChanged = false;
                    const oldStamina = this.state.stamina;
                    this.state.stamina -= staminaDrainRate * delta;
                    if (this.state.stamina <= 0) {
                        this.state.stamina = 0;
                        this.state.running = false; // Force stop running
                        staminaChanged = true; // State changed
                        // Update button state externally
                        const runToggleButton = document.getElementById('run-toggle');
                        if (runToggleButton) {
                            runToggleButton.textContent = 'Run: OFF';
                            runToggleButton.classList.remove('bg-red-500', 'hover:bg-red-700');
                            runToggleButton.classList.add('bg-green-500', 'hover:bg-green-700');
                        }
                    }
                    // Set needsUpdate if stamina changed significantly or running state changed
                    if (staminaChanged || Math.round(oldStamina) !== Math.round(this.state.stamina)) {
                        this.needsUpdate = true;
                    }
                }

                // --- Stop Condition ---
                // Predict if next step overshoots target significantly
                const moveDelta = desiredVelocity.clone().multiplyScalar(delta);
                if (moveDelta.length() >= distance) {
                    this.model.position.x = this.moveTarget.x;
                    this.model.position.z = this.moveTarget.z;
                    this.moveTarget = null;
                    desiredVelocity.set(0, 0, 0);
                    isMoving = false;
                    this.needsUpdate = true; // Position snapped to target
                }

            } else {
                // Reached target or very close
                if (this.moveTarget !== null) { // Only update if we just arrived
                    this.moveTarget = null;
                    desiredVelocity.set(0, 0, 0); // Stop horizontal movement
                    isMoving = false;
                    this.needsUpdate = true; // Stopped moving
                }
            }
        } else {
            // No move target or is dancing
            if (this.velocity.x !== 0 || this.velocity.z !== 0) { // Check if currently moving horizontally
                desiredVelocity.set(0, 0, 0);
                isMoving = false;
                this.needsUpdate = true; // Stopped moving
            }
        }

        // Smoothly rotate model towards target direction
        if (!this.model.quaternion.equals(this.targetQuaternion)) {
            const angleDiff = this.model.quaternion.angleTo(this.targetQuaternion);
            this.model.quaternion.slerp(this.targetQuaternion, turnSpeed * delta);
            // Only set needsUpdate if rotation changes significantly (e.g., beyond a threshold)
            if (angleDiff > 0.01) { // Adjust threshold as needed
                this.needsUpdate = true;
            }
        }

        // --- Apply Horizontal Movement Velocity ---
        if (this.velocity.x !== desiredVelocity.x || this.velocity.z !== desiredVelocity.z) {
            this.velocity.x = desiredVelocity.x;
            this.velocity.z = desiredVelocity.z;
            this.needsUpdate = true; // Velocity changed
        }

        this.model.position.x += this.velocity.x * delta;
        this.model.position.z += this.velocity.z * delta;

        // --- Stamina Regen ---
        if (!this.state.running && !isMoving && this.onGround && !this.isJumping() && this.state.stamina < maxStamina) {
            const oldStamina = this.state.stamina;
            this.state.stamina += staminaRegenRate * delta;
            this.state.stamina = Math.min(this.state.stamina, maxStamina);
            // Set needsUpdate if stamina changed significantly
            if (Math.round(oldStamina) !== Math.round(this.state.stamina)) {
                this.needsUpdate = true;
            }
        }

        // --- Animation Logic ---
        if (this.state.dancing) {
            targetAnimation = 'dance';
        } else if (!this.onGround) {
            // Prioritize jump animation if vertical velocity is significant or just started jump
            if (this.state.animation === 'jump' || this.velocity.y > 0.1 || this.velocity.y < -0.5) { // Added threshold for falling
                targetAnimation = 'jump';
            } else if (this.state.animation === 'walk' || this.state.animation === 'run') {
                // If somehow walking/running mid-air (e.g. walked off edge), switch to idle/fall(jump)
                targetAnimation = 'idle'; // Or 'jump' if we want a falling animation
            } else {
                targetAnimation = this.state.animation; // Keep idle if just at apex
            }

        } else { // On Ground
            if (isMoving) {
                targetAnimation = (this.state.running && this.state.stamina > 0) ? 'run' : 'walk';
            } else {
                targetAnimation = 'idle';
            }
        }

        // Play the target animation if it's different from the current one
        // And handle the end of non-looping animations (like jump)
        const currentClip = this.currentAction ? this.currentAction.getClip() : null;
        const currentClipIsNonLooping = currentClip && (currentClip.loop === THREE.LoopOnce);

        if (this.state.animation !== targetAnimation || (currentClipIsNonLooping && !this.currentAction.isRunning())) {
            // If current animation is non-looping and finished, force transition even if targetAnimation is the same
            // e.g., finished 'jump', now transition to 'idle' even if targetAnimation was already 'idle'
            const loop = !(targetAnimation === 'jump'); // Jump animation doesn't loop
            this._playAnimation(targetAnimation, config.animation.fadeDuration, loop);
            // needsUpdate is set inside _playAnimation
        }

        // Flag for update if position changed significantly this frame
        // (We already flag for velocity, rotation, state changes like run/dance/stamina)
        // This covers the actual movement delta. A threshold might be useful here too.
        if (isMoving || !this.onGround) {
            this.needsUpdate = true;
        }
    }

    _updateRemote(delta) {
        // Interpolate position and rotation towards the latest network state
        const lerpFactor = 0.25; // Adjust for desired smoothness/responsiveness

        this.model.position.lerp(this.networkPosition, lerpFactor);
        this.model.quaternion.slerp(this.networkQuaternion, lerpFactor);

        // For remote players, animation is handled directly by setState calling _playAnimation
        // Gravity/collision are not simulated, position comes from network
        // Estimate if on ground based on interpolated position and a small threshold
        this.onGround = this.model.position.y <= (0.0 + 0.1);
    }

    _playAnimation(name, transitionDuration = config.animation.fadeDuration, loop = true) {
        const targetClip = this.animations[name]; // Use the mapped animation clip
        if (!targetClip) {
            console.warn(`Animation "${name}" not found! Available:`, Object.keys(this.animations));
            // Fallback to idle if requested animation is missing, unless idle is missing too
            if (name !== 'idle' && this.animations.idle) {
                this._playAnimation('idle', transitionDuration, true);
            }
            return; // Don't proceed if clip is missing
        }

        const previousAction = this.currentAction;
        const previousName = this.state.animation;

        // Only update state and trigger network update if the animation name actually changes
        if (previousName !== name) {
            this.state.animation = name; // Update state *before* getting new action
            if (this.isLocalPlayer) {
                this.needsUpdate = true; // Animation state changed
            }
        }

        const newAction = this.mixer.clipAction(targetClip);

        // Ensure loop mode is correct (especially for jump)
        newAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        if (!loop) {
            newAction.clampWhenFinished = true; // Stop on last frame if not looping
        }

        if (previousAction !== newAction) {
            // console.log(`Playing animation: ${name} (Loop: ${loop})`); // Debugging
            if (previousAction) {
                // If previous action was non-looping and finishing, don't fade out abruptly
                const prevClip = previousAction.getClip();
                if (prevClip.loop === THREE.LoopOnce && !previousAction.isRunning()) {
                    previousAction.stop(); // Just stop it instead of fading
                } else {
                    previousAction.fadeOut(transitionDuration);
                }
            }

            newAction
                .reset()
                .setEffectiveTimeScale(1)
                .setEffectiveWeight(1)
                .fadeIn(transitionDuration)
                .play();

            this.currentAction = newAction;

        } else if (!newAction.isRunning() && loop) {
            // If the same looping action somehow stopped, restart it
            // console.log(`Restarting looping animation: ${name}`); // Debugging
            newAction.reset().play();
        } else if (!loop && !newAction.isRunning() && previousName === name) {
            // If a non-looping animation (like jump) was requested again *after* it finished
            // Reset and play it again. Check previousName === name to avoid restarting
            // if we are transitioning *away* from jump to something else.
            // console.log(`Replaying non-looping animation: ${name}`); // Debugging
            newAction.reset().play();
        } else if (!loop && newAction.isRunning()) {
            // If a non-looping animation is requested again while *still running*,
            // let it continue usually. Could potentially reset/restart if needed.
            // e.g., spamming jump - might want to reset or ignore. Current: ignore.
        }
    }

    getPosition() {
        // Return the current model position
        return this.model.position;
    }

    removeFromScene() {
        if (this.scene && this.model) {
            this.scene.remove(this.model);
            // TODO: Consider disposing geometry/materials if they are unique clones
            // and not shared. If using shared geometry/material, don't dispose here.
            // this.model.traverse(child => {
            //     if (child.isMesh) {
            //         child.geometry?.dispose();
            //         // Only dispose material if it's a unique instance, not the shared one
            //         if(child.material && !child.material.isShared) { // Need a way to mark shared materials
            //              child.material.dispose();
            //         }
            //     }
            // });
        }
        // Clean up mixer? (Three.js docs say it's usually not necessary unless you have many)
        if (this.mixer) {
            this.mixer.stopAllAction();
            // this.mixer = null; // Let garbage collector handle it if no other references exist
        }
    }
}