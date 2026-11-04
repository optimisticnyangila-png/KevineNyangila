/**
 * FlowPost Notification System
 * Handles UI alerts and feedback
 */

export function showNotification(message, type = 'info') {
    let container = document.getElementById('notifications');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notifications';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }

    const notice = document.createElement('div');
    notice.className = `notification notification-${type}`;
    notice.textContent = message;
    container.appendChild(notice);

    window.setTimeout(() => {
        notice.remove();
        if (!container.children.length) {
            container.remove();
        }
    }, 5000);
}
