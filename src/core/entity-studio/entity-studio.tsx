import { createRoot } from "react-dom/client";
import { EntityStudioApp } from "./EntityStudioApp";
import React from "react";

const root = document.createElement("div");
document.body.appendChild(root);
createRoot(root).render(<EntityStudioApp />);
