"""Auth: lösenordshashning (bcrypt), sessioner och behörighetsguards.

Sluten inbjudan - ingen öppen registrering. Sessionen bär bara användarens id
(`request.session["uid"]`); SessionMiddleware signerar cookien."""
from __future__ import annotations

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database import User, get_db


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _user_from_session(request: Request, db: Session) -> User | None:
    uid = request.session.get("uid")
    if not uid:
        return None
    return db.get(User, uid)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    """Valfri auth (t.ex. för navigering) - None om ej inloggad."""
    return _user_from_session(request, db)


def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = _user_from_session(request, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inloggning krävs")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Adminbehörighet krävs")
    return user
