/**
 * Auth Page Scripts
 */
document.addEventListener('DOMContentLoaded', function() {
    // Auto-hide flash messages
    const flashMessage = document.getElementById('flash-message');
    if (flashMessage) {
        setTimeout(() => {
            flashMessage.style.opacity = '0';
            setTimeout(() => flashMessage.remove(), 300);
        }, 5000);
    }

    // Password confirmation validation
    const passwordConfirm = document.getElementById('password_confirm');
    const password = document.getElementById('password');
    
    if (passwordConfirm && password) {
        passwordConfirm.addEventListener('input', function() {
            if (this.value !== password.value) {
                this.setCustomValidity('Passwords do not match');
            } else {
                this.setCustomValidity('');
            }
        });
        
        password.addEventListener('input', function() {
            if (passwordConfirm.value && passwordConfirm.value !== this.value) {
                passwordConfirm.setCustomValidity('Passwords do not match');
            } else {
                passwordConfirm.setCustomValidity('');
            }
        });
    }

    // Form submission loading state
    document.querySelectorAll('.auth-form').forEach(form => {
        form.addEventListener('submit', function() {
            const btn = this.querySelector('button[type="submit"]');
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Please wait...';
            }
        });
    });
});
