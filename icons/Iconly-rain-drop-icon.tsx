
type IconlyIconProps = {
    size?:number;
    color?:string;
    secondColor?:string;
}

export const IconlyRaindrop = ({ size = 16, color = "currentColor", secondColor = "currentColor" }: IconlyIconProps) => {
    return (
		<svg width={size} height={size} viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path fillRule="evenodd" clipRule="evenodd" d="M12.5002 20.5C6.3526 20.5 3.57838 13.6669 6.23406 9.51157C8.70779 5.95627 12.5002 3.5 12.5002 3.5C12.5002 3.5 16.2925 5.95627 18.7663 9.51157C21.4219 13.6669 18.6477 20.5 12.5002 20.5Z" fill={secondColor}></path>
		</svg>
    ) 
}