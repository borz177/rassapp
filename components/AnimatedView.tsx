// src/components/AnimatedView.tsx
import { motion } from "framer-motion";
import { ReactNode } from "react";

const variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 30 : -30,
    opacity: 0,
    scale: 0.97
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 25,
      duration: 0.25
    }
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 30 : -30,
    opacity: 0,
    scale: 0.97,
    transition: {
      duration: 0.2
    }
  })
};

interface AnimatedViewProps {
  children: ReactNode;
  direction: number;
  currentView: string;
}

const AnimatedView: React.FC<AnimatedViewProps> = ({
  children,
  direction,
  currentView
}) => {
  return (
    <motion.div
      key={currentView}
      custom={direction}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      className="w-full h-full overflow-y-auto"
    >
      {children}
    </motion.div>
  );
};

export default AnimatedView;