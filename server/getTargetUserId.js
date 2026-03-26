export const getTargetUserId = (user) => {
  // Сотрудники видят данные своего менеджера
  if (user.role === 'employee') {
    return user.managerId;
  }
  // Инвесторы, менеджеры и админы видят СВОИ данные
  return user.id;
};

/**
 * Проверяет, имеет ли пользователь право редактировать данные целевого пользователя
 */
export const canAccessUserData = (currentUser, targetUserId) => {
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'manager' && targetUserId === currentUser.id) return true;
  if (currentUser.role === 'employee' && targetUserId === currentUser.managerId) return true;
  if (currentUser.role === 'investor' && targetUserId === currentUser.id) return true;
  return false;
};