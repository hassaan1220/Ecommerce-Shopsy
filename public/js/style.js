// navbar js
document.addEventListener('DOMContentLoaded', function () {
    const hamburger = document.querySelector('.hamburger');
    const nav = document.querySelector('.nav');
    const menuOverlay = document.querySelector('.menu-overlay');
    const navLinks = document.querySelectorAll('.nav-link');
    const body = document.body;
    const closeBtn = document.querySelector('.close-btn'); // ✅ moved inside

    // Toggle menu function
    function toggleMenu() {
        hamburger.classList.toggle('active');
        nav.classList.toggle('active');
        menuOverlay.classList.toggle('active');
        body.classList.toggle('no-scroll');

        // Update aria-expanded attribute
        const isExpanded = hamburger.classList.contains('active');
        hamburger.setAttribute('aria-expanded', isExpanded);
    }

    // Hamburger click event
    hamburger.addEventListener('click', toggleMenu);

    // Overlay click event
    menuOverlay.addEventListener('click', toggleMenu);

    // ✅ Close button event
    if (closeBtn) {
        closeBtn.addEventListener('click', toggleMenu);
    }

    // Nav link click events
    navLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            if (!this.querySelector('.submenu')) {
                toggleMenu();

                const href = this.getAttribute('href');
                if (href.startsWith('#')) {
                    e.preventDefault();
                    const target = document.querySelector(href);
                    if (target) {
                        setTimeout(() => {
                            target.scrollIntoView({ behavior: 'smooth' });
                        }, 300);
                    }
                }
            }
        });
    });

    // Close menu on ESC key
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && nav.classList.contains('active')) {
            toggleMenu();
        }
    });

    // Animation on scroll
    function animateOnScroll() {
        const elements = document.querySelectorAll('.hero-title, .hero-text, .cta-button');
        elements.forEach((element, index) => {
            const elementPosition = element.getBoundingClientRect().top;
            const screenPosition = window.innerHeight / 1.2;

            if (elementPosition < screenPosition) {
                setTimeout(() => {
                    element.style.opacity = '1';
                    element.style.transform = 'translateY(0)';
                }, index * 200);
            }
        });
    }

    // Set initial styles
    document.querySelectorAll('.hero-title, .hero-text, .cta-button').forEach(element => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(20px)';
        element.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
    });

    // Run on load and scroll
    window.addEventListener('load', animateOnScroll);
    window.addEventListener('scroll', animateOnScroll);
});

// slider js
document.addEventListener('DOMContentLoaded', function () {
    // Elements
    const slideEls = Array.from(document.querySelectorAll('.slide'));
    const dotButtons = Array.from(document.querySelectorAll('.slider-dot'));
    const prevButton = document.querySelector('.slider-nav-btn.prev');
    const nextButton = document.querySelector('.slider-nav-btn.next');
    const counterEl = document.querySelector('.slide-counter');
    const progressEl = document.querySelector('.progress-bar');

    // State
    let currentIndex = 0;
    let timerId = null;
    const AUTO_ADVANCE_MS = 6000;

    // Set ARIA and initial visibility
    function setInitialStates() {
        slideEls.forEach((el, i) => el.setAttribute('aria-hidden', i === currentIndex ? 'false' : 'true'));
        dotButtons.forEach((btn, i) => btn.setAttribute('aria-pressed', i === currentIndex ? 'true' : 'false'));
    }

    // Go to a particular slide index
    function goTo(index) {
        const safeIndex = ((index % slideEls.length) + slideEls.length) % slideEls.length;
        slideEls.forEach((el, i) => {
            const active = i === safeIndex;
            el.classList.toggle('active', active);
            el.setAttribute('aria-hidden', active ? 'false' : 'true');
        });
        dotButtons.forEach((btn, i) => {
            const pressed = i === safeIndex;
            btn.classList.toggle('active', pressed);
            btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        });
        currentIndex = safeIndex;
        updateCounter();
        restartProgress();
    }

    function next() { goTo(currentIndex + 1); }
    function prev() { goTo(currentIndex - 1); }

    function updateCounter() {
        if (counterEl) {
            counterEl.textContent = `${String(currentIndex + 1).padStart(2, '0')} / ${String(slideEls.length).padStart(2, '0')}`;
        }
    }

    function restartProgress() {
        clearInterval(timerId);
        if (progressEl) {
            progressEl.style.transition = 'none';
            progressEl.style.width = '0%';
            // Allow the DOM to settle then animate the progress bar
            setTimeout(() => {
                progressEl.style.transition = `width ${AUTO_ADVANCE_MS}ms linear`;
                progressEl.style.width = '100%';
            }, 10);
        }
        timerId = setInterval(next, AUTO_ADVANCE_MS);
    }

    function pause() { clearInterval(timerId); }

    // Event wiring
    function wireEvents() {
        prevButton?.addEventListener('click', prev);
        nextButton?.addEventListener('click', next);

        dotButtons.forEach((btn, i) => {
            btn.addEventListener('click', () => goTo(i));
            btn.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); goTo(i); }
            });
        });

        const sliderRoot = document.querySelector('.hero-slider');
        if (sliderRoot) {
            sliderRoot.addEventListener('mouseenter', pause);
            sliderRoot.addEventListener('mouseleave', restartProgress);
            sliderRoot.addEventListener('focusin', pause);
            sliderRoot.addEventListener('focusout', restartProgress);

            // Touch swipe
            let touchStartX = 0;
            sliderRoot.addEventListener('touchstart', (ev) => { touchStartX = ev.changedTouches[0].screenX; }, false);
            sliderRoot.addEventListener('touchend', (ev) => {
                const touchEndX = ev.changedTouches[0].screenX;
                if (touchEndX < touchStartX - 50) next();
                else if (touchEndX > touchStartX + 50) prev();
            }, false);
        }

        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'ArrowLeft') prev();
            if (ev.key === 'ArrowRight') next();
        });
    }

    // Bootstrap
    setInitialStates();
    wireEvents();
    goTo(0);
    restartProgress(); // start auto-sliding on page load
});

// images tab view (view-products.ejs page)
const thumbs = document.querySelectorAll('.tab-buttons img');
const preview = document.getElementById('preview');

thumbs.forEach(img => {
    img.addEventListener('click', () => {
        // Change preview image
        preview.src = img.getAttribute('data-full');

        // Remove active from all and add to clicked
        thumbs.forEach(i => i.classList.remove('active'));
        img.classList.add('active');
    });
});

// show case tab view js
document.addEventListener("DOMContentLoaded", () => {
    const tabs = document.querySelectorAll(".showcase-tab");
    const panes = document.querySelectorAll(".tab-pane");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            // remove active
            tabs.forEach(t => t.classList.remove("active"));
            panes.forEach(p => p.classList.remove("show", "active"));

            // activate clicked
            tab.classList.add("active");
            document.getElementById(tab.dataset.tab).classList.add("show", "active");
        });
    });
});
