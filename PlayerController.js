import * as THREE from 'three';
import { config } from './config.js';

export class PlayerController {
    constructor(clientId, scene, model, mixer, animations, initialState) {
        this.clientId = clientId;
        this.scene = scene;
        this.model = model;
        this.mixer = mixer;
        this.animations = animations; // { 'idle':AnimationClip, 'walk':AnimationClip, ... }

        this.state = {
            x: initialState?.x || 0,
            y: initialState?.y || 0,
            z: initialState?.z || 0,
            color: initialState?.color || '#ff0000',
            animation: initialState?.animation || 'idle',
            stamina: initialState?.stamina ?? config.character.stamina,
            running: initialState?.running || false,
            dancing: initialState?.dancing || false,
        };

        this.isLocalPlayer = false;
        this.velocity = new THREE.Vector3();
        this.moveTarget = null; // THREE.Vector3 target position for click-to-move
        this.currentAction = null; // Currently playing AnimationAction
        this.needsUpdate = false; // Flag for network update throttling
        this.onGround = true;
        this.jumpRequested = false;


        // Initialize position and color
        this.model.position.set(this.state.x, this.state.y, this.state.z);
        this.setColor(this.state.color);
        this._playAnimation(this.state.animation); // Start initial animation

        // Debugging helper
        // const axesHelper = new THREE.AxesHelper(2);
        // this.model.add(axesHelper);
    }

    getState() {
        // Return only the data needed for synchronization
        return {
            x: this.model.position.x,
            y: this.model.position.y,
            z: this.model.position.z,
            color: this.state.color,
            animation: this.state.animation,
            stamina: this.state.stamina,
            running: this.state.running,
            dancing: this.state.dancing,
        };
    }

     setState(newState) {
        // Update local state from network data
        const positionChanged = this.state.x !== newState.x || this.state.y !== newState.y || this.state.z !== newState.z;
        const colorChanged = this.state.color !== newState.color;
        const animationChanged = this.state.animation !== newState.animation;
        const staminaChanged = this.state.stamina !== newState.stamina;
        const runningChanged = this.state.running !== newState.running;
        const dancingChanged = this.state.dancing !== newState.dancing;


        Object.assign(this.state, newState); // Update internal state


        if (positionChanged && !this.isLocalPlayer) {
            // Interpolate or directly set position for remote players
             this.model.position.lerp(new THREE.Vector3(newState.x, newState.y, newState.z), 0.5); // Adjust lerp factor as needed
             // Or teleport: this.model.position.set(newState.x, newState.y, newState.z);
         }


         if (colorChanged) {
            this.setColor(newState.color);
        }


        if (animationChanged) {
             // Don't abruptly change local player animation if they are controlling it
             // unless it's a specific state like dancing
             if (!this.isLocalPlayer || newState.dancing !== this.state.dancing) {
                 this._playAnimation(newState.animation);
             }
        }

        // Update stamina and running state visually if needed (e.g., UI elements for remote players)
        // Currently only affects local player via UI update in main.js
    }


    setColor(colorHex) {
        this.state.color = colorHex;
        this.model.traverse((child) => {
            if (child.isMesh) {
                // Ensure material is MeshStandardMaterial or similar that supports color
                if (!child.material.isMeshStandardMaterial) {
                     // Replace material if necessary, preserving maps if possible
                     const oldMaterial = child.material;
                     child.material = new THREE.MeshStandardMaterial({
                         map: oldMaterial.map, // Preserve texture if exists
                         // metalnessMap: oldMaterial.metalnessMap, // Preserve other maps
                         // roughnessMap: oldMaterial.roughnessMap,
                         // normalMap: oldMaterial.normalMap,
                     });
                }
                 child.material.color.set(colorHex);
            }
        });
    }

    setMoveTarget(targetPoint) {
        if (this.state.dancing) return; // Cannot move while dancing
        this.moveTarget = targetPoint.clone();
        this.moveTarget.y = this.model.position.y; // Keep target on the same Y plane initially for ground movement
    }

    jump() {
        if (this.onGround && this.state.stamina >= 5) { // Stamina cost for jump
            this.velocity.y = config.character.jumpHeight;
            this.onGround = false;
            this.state.stamina -= 5;
            this.needsUpdate = true;
             this._playAnimation('jump', 0.2, false); // Play jump animation once
             // Transition back to idle/walk/run after jump animation duration? Or based on landing?
             // For now, rely on velocity check to switch back
        }
    }

     toggleRun() {
        if (this.state.dancing) return; // Cannot run while dancing
        this.state.running = !this.state.running;
         if (!this.state.running) {
             // If stopping running, revert to walk or idle animation
             const targetSpeed = this.velocity.length();
             this._playAnimation(targetSpeed > 0.1 ? 'walk' : 'idle');
         }
         this.needsUpdate = true;
     }

     isRunning() {
         return this.state.running;
     }

     isJumping() {
        return !this.onGround;
     }

    getStamina() {
        return this.state.stamina;
    }

     toggleDance() {
        this.state.dancing = !this.state.dancing;
        if (this.state.dancing) {
            this._playAnimation('dance', 0.2); // Smooth transition to dance
            this.moveTarget = null; // Stop moving
            this.velocity.set(0, this.velocity.y, 0); // Keep vertical velocity for gravity
            if (this.state.running) {
                this.state.running = false; // Stop running if dancing starts
                // Update run toggle button text externally if needed
            }
        } else {
            this._playAnimation('idle', 0.2); // Transition back to idle
        }
        this.needsUpdate = true;
    }


    update(delta, worldManager) {
        const gravity = config.character.gravity;
        const speed = config.character.speed;
        const runMultiplier = config.character.runMultiplier;
        const staminaDrainRate = config.character.staminaDrainRate;
        const staminaRegenRate = config.character.staminaRegenRate;
        const maxStamina = config.character.stamina;


        let desiredVelocity = new THREE.Vector3();
        let targetAnimation = this.state.dancing ? 'dance' : 'idle';
        let isMoving = false;

        // --- Movement ---
        if (this.isLocalPlayer && this.moveTarget && !this.state.dancing) {
            const direction = this.moveTarget.clone().sub(this.model.position);
            direction.y = 0; // Ignore vertical difference for horizontal movement planning
            const distance = direction.length();

            const effectiveSpeed = (this.state.running && this.state.stamina > 0) ? speed * runMultiplier : speed;

            if (distance > 0.1) { // Threshold to stop
                isMoving = true;
                direction.normalize();
                desiredVelocity.copy(direction).multiplyScalar(effectiveSpeed);

                // Rotate model to face movement direction
                const angle = Math.atan2(direction.x, direction.z);
                const targetQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                this.model.quaternion.slerp(targetQuaternion, 0.1); // Smooth rotation

                 targetAnimation = (this.state.running && this.state.stamina > 0) ? 'run' : 'walk';

                 // Drain stamina if running and moving
                if (this.state.running && this.state.stamina > 0) {
                    this.state.stamina -= staminaDrainRate * delta;
                    if (this.state.stamina <= 0) {
                        this.state.stamina = 0;
                        this.state.running = false; // Force stop running
                         // Update button state externally if needed
                         document.getElementById('run-toggle').textContent = 'Run: OFF';
                         targetAnimation = 'walk'; // Revert to walk animation
                    }
                     this.needsUpdate = true; // Stamina changed
                 }

                // Stop moving if target reached
                if (distance < effectiveSpeed * delta) {
                    this.model.position.x = this.moveTarget.x;
                    this.model.position.z = this.moveTarget.z;
                    this.moveTarget = null;
                    desiredVelocity.set(0, 0, 0);
                    isMoving = false;
                     targetAnimation = 'idle';
                }
            } else {
                // Reached target
                this.moveTarget = null;
                 targetAnimation = 'idle';
            }
        }

        // --- Stamina Regen ---
        if (this.isLocalPlayer && !this.state.running && isMoving === false && this.state.stamina < maxStamina) {
             this.state.stamina += staminaRegenRate * delta;
             if (this.state.stamina > maxStamina) {
                 this.state.stamina = maxStamina;
             }
             this.needsUpdate = true; // Stamina changed
        }


        // --- Apply Gravity & Vertical Movement ---
        this.velocity.y += gravity * delta;
        this.model.position.y += this.velocity.y * delta;


        // --- Ground Collision ---
        // Simple ground collision at y=0 for now
        const groundY = 0; // Assume flat ground for now
         if (this.model.position.y <= groundY) {
            this.model.position.y = groundY;
            this.velocity.y = 0;
             if (!this.onGround) { // Just landed
                 // If we were playing jump animation, transition back based on movement
                 if (this.state.animation === 'jump') {
                     targetAnimation = isMoving ? (this.state.running ? 'run' : 'walk') : 'idle';
                 }
             }
            this.onGround = true;
        } else {
            this.onGround = false;
             // If falling or jumping, potentially override walk/run/idle animation
             if (!this.state.dancing && this.state.animation !== 'jump') {
                // Simple check: if vertical velocity is significant, maybe play jump/fall anim?
                 // For now, let's stick to jump initiating the animation.
                 // targetAnimation = 'jump'; // Or a 'fall' animation if available
             }
        }

        // --- Apply Horizontal Movement ---
        this.velocity.x = desiredVelocity.x;
        this.velocity.z = desiredVelocity.z;
        this.model.position.x += this.velocity.x * delta;
        this.model.position.z += this.velocity.z * delta;

        // --- Update Animation ---
        if (this.isLocalPlayer && !this.onGround && this.state.animation !== 'jump') {
             // While in air, if not already jumping/dancing, maybe force idle or a falling anim?
             // Keep existing animation for now unless explicitly jumping.
         } else if (this.isLocalPlayer && this.onGround && this.state.animation !== targetAnimation && !this.state.dancing && this.state.animation !== 'jump') {
             // Only transition ground animations if on ground and not dancing/mid-jump anim
             this._playAnimation(targetAnimation, 0.2); // Smooth transition
             this.state.animation = targetAnimation;
             this.needsUpdate = true; // Animation changed
         } else if (!this.isLocalPlayer && this.state.animation !== targetAnimation) {
             // Remote players should follow their state's animation
             // Handled in setState now
         }

        // --- Update Mixer ---
        this.mixer.update(delta);

        // --- Check if state changed significantly for network update ---
        // Basic check - more sophisticated checks could be added (e.g., distance threshold)
        if (this.isLocalPlayer && (isMoving || this.velocity.y !== 0 || this.needsUpdate)) {
            this.needsUpdate = true;
        }
    }

    _playAnimation(name, transitionDuration = 0.2, loop = true) {
        const clip = this.animations[name.toLowerCase()];
        if (!clip) {
            console.warn(`Animation "${name}" not found! Falling back to idle.`);
             if (name.toLowerCase() !== 'idle') { // Prevent infinite loop if idle is missing
                 this._playAnimation('idle', transitionDuration, loop);
             }
             return;
        }

        const newAction = this.mixer.clipAction(clip);

        // Ensure looping is set correctly
        newAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        newAction.clampWhenFinished = !loop; // Important for non-looping animations

        if (this.currentAction) {
            if (this.currentAction !== newAction) {
                this.currentAction.fadeOut(transitionDuration);
                newAction.reset().fadeIn(transitionDuration).play();
            } else if (!newAction.isRunning()) {
                 // If the same action finished (e.g. non-looping jump), restart it if needed
                 // This logic might need adjustment based on desired behavior
                 newAction.reset().fadeIn(transitionDuration).play();
            }
        } else {
            newAction.reset().fadeIn(transitionDuration).play();
        }

        this.currentAction = newAction;
        this.state.animation = name; // Update internal state tracker
    }

    getPosition() {
        return this.model.position;
    }

    removeFromScene() {
        this.scene.remove(this.model);
        // Potentially stop mixer, dispose geometry/material if needed for cleanup
    }
}


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

        // --- Apply Gravity & Vertical Movement (Both Local & Remote) ---
        // Only apply gravity if not forcibly set by network (e.g. y=0 on flat ground)
        // For remote players, y is mostly driven by interpolation
        if(this.isLocalPlayer) {
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
        const { walkSpeed, runSpeed, staminaDrainRate, staminaRegenRate, maxStamina, turnSpeed } = config.character;

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
                    this.state.stamina -= staminaDrainRate * delta;
                    if (this.state.stamina <= 0) {
                        this.state.stamina = 0;
                        this.state.running = false; // Force stop running
                        this.needsUpdate = true; // State changed
                        // Update button state externally
                         const runToggleButton = document.getElementById('run-toggle');
                         if(runToggleButton) {
                            runToggleButton.textContent = 'Run: OFF';
                            runToggleButton.classList.remove('bg-red-500', 'hover:bg-red-700');
                            runToggleButton.classList.add('bg-green-500', 'hover:bg-green-700');
                         }
                    }
                    // No need to set needsUpdate=true just for stamina drain,
                    // it will be sent periodically anyway or when other state changes.
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
                }

            } else {
                // Reached target or very close
                this.moveTarget = null;
                desiredVelocity.set(0, 0, 0); // Stop horizontal movement
                isMoving = false;
            }
        } else {
            // No move target or is dancing
            desiredVelocity.set(0, 0, 0);
            isMoving = false;
        }

         // Smoothly rotate model towards target direction
         this.model.quaternion.slerp(this.targetQuaternion, turnSpeed * delta);


        // --- Apply Horizontal Movement Velocity ---
        this.velocity.x = desiredVelocity.x;
        this.velocity.z = desiredVelocity.z;

        this.model.position.x += this.velocity.x * delta;
        this.model.position.z += this.velocity.z * delta;


        // --- Stamina Regen ---
        if (!this.state.running && !isMoving && this.onGround && this.state.stamina < maxStamina) {
             this.state.stamina += staminaRegenRate * delta;
             this.state.stamina = Math.min(this.state.stamina, maxStamina);
             // No need to set needsUpdate=true just for stamina regen
        }


        // --- Animation Logic ---
        if (this.state.dancing) {
            targetAnimation = 'dance';
        } else if (!this.onGround && this.state.animation !== 'jump') {
            // If falling and not already in jump animation, trigger jump animation
            // Check velocity to prevent triggering jump at apex
             if(this.velocity.y < -0.1) {
                targetAnimation = 'jump';
             } else {
                // Keep previous animation during apex/slight upward movement unless it was walk/run
                if (this.state.animation === 'walk' || this.state.animation === 'run') {
                    targetAnimation = 'idle'; // Don't walk/run in air
                } else {
                    targetAnimation = this.state.animation; // Keep idle or jump
                }
             }

        } else if (this.onGround) {
            if (isMoving) {
                targetAnimation = (this.state.running && this.state.stamina > 0) ? 'run' : 'walk';
            } else {
                targetAnimation = 'idle';
            }
        } else {
            // Keep current animation if in air and already jumping
            targetAnimation = this.state.animation;
        }


        // Play the target animation if it's different from the current one
        if (this.state.animation !== targetAnimation) {
             const loop = !(targetAnimation === 'jump'); // Jump animation doesn't loop
             this._playAnimation(targetAnimation, config.animation.fadeDuration, loop);
             // needsUpdate is set inside _playAnimation
        }

        // Check if position or rotation changed significantly enough to warrant an update
        // Basic check - can be improved with distance/angle thresholds
        if (isMoving || !this.onGround || this.needsUpdate) { // Force update if needsUpdate flag is already set
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
         this.onGround = this.model.position.y <= 0.1; // Estimate if on ground based on interpolated position
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
        this.state.animation = name; // Update state *before* getting new action
        const newAction = this.mixer.clipAction(targetClip);

        // Ensure loop mode is correct (especially for jump)
        newAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        if (!loop) {
            newAction.clampWhenFinished = true; // Stop on last frame if not looping
        }


        if (previousAction !== newAction) {
            // console.log(`Playing animation: ${name} (Loop: ${loop})`); // Debugging
            if (previousAction) {
                previousAction.fadeOut(transitionDuration);
            }

            newAction
                .reset()
                .setEffectiveTimeScale(1)
                .setEffectiveWeight(1)
                .fadeIn(transitionDuration)
                .play();

            this.currentAction = newAction;

            if(this.isLocalPlayer) {
                 this.needsUpdate = true; // Animation state changed
            }
        } else if (!newAction.isRunning() && loop) {
             // If the same looping action somehow stopped, restart it
            // console.log(`Restarting looping animation: ${name}`); // Debugging
             newAction.reset().play();
        } else if (!loop && newAction.isRunning()) {
            // If a non-looping animation (like jump) is requested again while running,
            // reset and play it again.
             // console.log(`Restarting non-looping animation: ${name}`); // Debugging
            // newAction.reset().play(); // Let jump play through? Maybe not reset.
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
            //         child.material?.dispose();
            //     }
            // });
        }
        // Clean up mixer? (Three.js docs say it's usually not necessary)
        // this.mixer = null;
    }
}

